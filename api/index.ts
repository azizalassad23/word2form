import express from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { google } from 'googleapis';
import { GoogleGenAI } from '@google/genai';
import mammoth from 'mammoth';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' })); // Increase limit for large payloads
app.use(cookieParser());

// Configure Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Google OAuth Configuration
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Helper to sanitize APP_URL
const getAppUrl = () => {
  const url = process.env.APP_URL;
  if (!url) return '';
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

const REDIRECT_URI = `${getAppUrl()}/api/auth/callback`;

// Scopes
const SCOPES = [
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- API Routes ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', environment: process.env.NODE_ENV });
});

// 1. Get Auth URL
app.get('/api/auth/url', (req, res) => {
  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return res.status(500).json({ error: 'Google Client ID/Secret not configured' });
    }
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      include_granted_scopes: true
    });
    res.json({ url: authUrl });
  } catch (error: any) {
    console.error('Auth URL Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Auth Callback
app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') return res.status(400).send('Missing code');

  try {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    const { tokens } = await oauth2Client.getToken(code);
    const script = `
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'OAUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
          window.close();
        } else {
          document.body.innerHTML = 'Authentication successful. You can close this window.';
        }
      </script>
    `;
    res.send(script);
  } catch (error) {
    console.error('Auth Error:', error);
    res.status(500).send('Authentication failed');
  }
});

// 3. Parse File (Extract Questions)
app.post('/api/parse', upload.single('file'), async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    let prompt = '';
    let contents: any[] = [];

    // Prompt instructions
    const systemPrompt = `
      You are an expert quiz parser. Extract questions from the provided document and format them as a JSON object.
      
      CRITICAL INSTRUCTIONS:
      1.  **Analyze Visually:** Look for questions, options, and correct answers.
      2.  **Handle Incomplete Questions:** If a question starts in this chunk but finishes in the next, try to make sense of it.
      3.  **Images/Diagrams:** Describe them in text (e.g., "[Image: Triangle ABC]").
      4.  **Math:** Use simple text or LaTeX for formulas.
      5.  **Format:** Return ONLY a JSON array of objects.
      
      JSON Structure:
      {
        "title": "Question text",
        "options": ["A", "B", "C", "D"],
        "correctAnswer": "Correct option text (or null)",
        "type": "MULTIPLE_CHOICE"
      }
    `;

    if (file.mimetype === 'application/pdf') {
      // PDF: Use Multimodal (Base64)
      const base64Data = file.buffer.toString('base64');
      
      // Construct prompt for PDF
      const pdfPrompt = `
        You are an expert quiz parser. Extract questions from the provided PDF document chunk.
        
        CRITICAL INSTRUCTIONS:
        1.  **Analyze Visually:** Look for questions, options, and correct answers.
        2.  **Handle Incomplete Questions:** If a question starts in this chunk but finishes in the next, try to make sense of it.
        3.  **Images/Diagrams:** Describe them in text (e.g., "[Image: Triangle ABC]").
        4.  **Math:** Use simple text or LaTeX for formulas.
        5.  **Format:** Return ONLY a JSON array of objects.
        
        JSON Structure:
        {
          "title": "Question text",
          "options": ["A", "B", "C", "D"],
          "correctAnswer": "Correct option text (or null)",
          "type": "MULTIPLE_CHOICE"
        }
      `;

      contents = [
        {
          role: 'user',
          parts: [
            { text: pdfPrompt },
            { inlineData: { mimeType: 'application/pdf', data: base64Data } }
          ]
        }
      ];
    } else if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
      file.mimetype === 'application/msword'
    ) {
      // Word: Extract Text with Mammoth + Text Prompt
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const text = result.value;
      if (!text.trim()) throw new Error('Could not extract text from Word document');
      
      contents = [
        {
          role: 'user',
          parts: [{ text: systemPrompt + `\n\nDocument Text:\n${text.substring(0, 30000)}` }]
        }
      ];
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    const result = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: contents,
      config: { responseMimeType: 'application/json' }
    });

    const responseText = result.text();
    let quizData = [];
    try {
      quizData = JSON.parse(responseText || '[]');
    } catch (e) {
      const match = responseText?.match(/\[.*\]/s);
      if (match) quizData = JSON.parse(match[0]);
    }

    res.json({ success: true, questions: quizData || [] });

  } catch (error: any) {
    console.error('Parse error:', error);
    res.status(500).json({ error: error.message || 'Failed to parse document' });
  }
});

// 4. Create Form (From Reviewed Data)
app.post('/api/create-form', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const accessToken = authHeader.split(' ')[1];
  const { title, questions } = req.body;

  if (!questions || !Array.isArray(questions)) {
    return res.status(400).json({ error: 'Invalid questions data' });
  }

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const forms = google.forms({ version: 'v1', auth: oauth2Client });

    // 1. Create Form
    const createResponse = await forms.forms.create({
      requestBody: {
        info: {
          title: title || 'Generated Quiz',
          documentTitle: title || 'Generated Quiz',
        }
      }
    });

    const formId = createResponse.data.formId;
    if (!formId) throw new Error('Failed to create form');

    // 2. Add Questions
    const requests = questions.map((q: any, index: number) => {
      const isMultipleChoice = q.type === 'MULTIPLE_CHOICE' && q.options && q.options.length > 0;
      let questionItem: any;
      
      if (isMultipleChoice) {
        questionItem = {
          question: {
            required: true,
            choiceQuestion: {
              type: 'RADIO',
              options: q.options.map((opt: string) => ({ value: opt })),
              shuffle: true
            }
          }
        };
      } else {
        questionItem = {
          question: {
            required: true,
            textQuestion: { paragraph: false }
          }
        };
      }
      
      return {
        createItem: {
          item: { title: q.title, questionItem: questionItem },
          location: { index: index }
        }
      };
    });

    if (requests.length > 0) {
      await forms.forms.batchUpdate({
        formId: formId,
        requestBody: { requests: requests }
      });
    }

    res.json({ 
      success: true, 
      formUrl: createResponse.data.responderUri,
      editUrl: `https://docs.google.com/forms/d/${formId}/edit`
    });

  } catch (error: any) {
    console.error('Create Form error:', error);
    res.status(500).json({ error: error.message || 'Failed to create form' });
  }
});

export default app;
