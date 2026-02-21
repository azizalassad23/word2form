import express from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { google } from 'googleapis';
import { GoogleGenAI } from '@google/genai';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());

// Configure Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Google OAuth Configuration
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Helper to sanitize APP_URL (remove trailing slash if present)
const getAppUrl = () => {
  const url = process.env.APP_URL;
  if (!url) return '';
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

const REDIRECT_URI = `${getAppUrl()}/api/auth/callback`;

// Scopes for Google Forms and Drive
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

    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      include_granted_scopes: true
    });

    res.json({ url: authUrl });
  } catch (error: any) {
    console.error('Auth URL Error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate auth URL' });
  }
});

// 2. Auth Callback
app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing code');
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    
    const script = `
      <script>
        if (window.opener) {
          window.opener.postMessage({ 
            type: 'OAUTH_SUCCESS', 
            tokens: ${JSON.stringify(tokens)} 
          }, '*');
          window.close();
        } else {
          document.body.innerHTML = 'Authentication successful. You can close this window.';
        }
      </script>
    `;
    
    res.send(script);
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    res.status(500).send('Authentication failed');
  }
});

    // 3. Parse File to JSON (Preview)
    app.post('/api/parse', upload.single('file'), async (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    
      const file = req.file;
    
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
    
      try {
        // Polyfill DOMMatrix for pdf-parse in Node.js environment
        if (typeof (global as any).DOMMatrix === 'undefined') {
          (global as any).DOMMatrix = class DOMMatrix {
            a: number; b: number; c: number; d: number; e: number; f: number;
            constructor() {
              this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
            }
            toString() { return "matrix(1, 0, 0, 1, 0, 0)"; }
          } as any;
        }
    
        // A. Extract Text (Try local extraction first)
        let text = '';
        try {
            if (file.mimetype === 'application/pdf') {
                // Lazy load pdf-parse
                const pdfParse = require('pdf-parse');
                if (typeof pdfParse === 'function') {
                    const data = await pdfParse(file.buffer);
                    text = data.text;
                }
            } else if (
              file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
              file.mimetype === 'application/msword'
            ) {
              const result = await mammoth.extractRawText({ buffer: file.buffer });
              text = result.value;
            }
        } catch (extractError) {
            console.warn('Local text extraction failed, falling back to multimodal:', extractError);
        }
    
        // B. Parse with Gemini
        const systemPrompt = `
          You are a quiz parser. Extract questions from the provided content and format them as a JSON object.
          The JSON should be an array of objects, where each object represents a question.
          
          Each question object should have:
          - "title": The question text (string).
          - "options": An array of strings representing the possible answers (if multiple choice).
          - "correctAnswer": The correct answer string (must match one of the options exactly). If not found, leave null.
          - "type": "MULTIPLE_CHOICE" or "TEXT" (if no options found).
        `;

        let parts: any[] = [];
        
        if (text && text.trim().length > 0) {
            // Use extracted text
            parts = [{ text: systemPrompt + "\n\nText to parse:\n" + text.substring(0, 30000) }];
        } else {
            // Fallback: Send file directly to Gemini (Multimodal)
            console.log('Using multimodal input for file:', file.mimetype);
            parts = [
                { text: systemPrompt },
                {
                    inlineData: {
                        mimeType: file.mimetype,
                        data: file.buffer.toString('base64')
                    }
                }
            ];
        }
    
        const result = await genAI.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: [{ role: 'user', parts: parts }],
          config: {
            responseMimeType: 'application/json'
          }
        });
    
        const quizData = JSON.parse(result.text || '[]');
    
        if (!Array.isArray(quizData) || quizData.length === 0) {
          return res.status(500).json({ error: 'Failed to parse quiz data from file.' });
        }
        
        res.json({ success: true, questions: quizData });
    
      } catch (error: any) {
        console.error('Parse error:', error);
        res.status(500).json({ error: error.message || 'An error occurred during parsing' });
      }
    });

    // 4. Publish to Google Form
    app.post('/api/publish', async (req, res) => {
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
        // C. Create Google Form
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: accessToken });
    
        const forms = google.forms({ version: 'v1', auth: oauth2Client });
    
        // 1. Create a new form
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
    
        // 2. Add questions to the form (batchUpdate)
        const requests = questions.map((q: any, index: number) => {
          const questionItem: any = {
            question: {
              required: true,
              choiceQuestion: {
                type: 'RADIO',
                options: q.options?.map((opt: string) => ({ value: opt })) || [],
                shuffle: true
              }
            }
          };
          
          return {
            createItem: {
              item: {
                title: q.title,
                questionItem: questionItem
              },
              location: {
                index: index
              }
            }
          };
        });
    
        if (requests.length > 0) {
          await forms.forms.batchUpdate({
            formId: formId,
            requestBody: {
              requests: requests
            }
          });
        }
    
        res.json({ 
          success: true, 
          formUrl: createResponse.data.responderUri,
          editUrl: `https://docs.google.com/forms/d/${formId}/edit`
        });
    
      } catch (error: any) {
        console.error('Publish error:', error);
        res.status(500).json({ error: error.message || 'An error occurred during publishing' });
      }
    });

export default app;
