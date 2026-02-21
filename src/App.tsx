import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Upload, FileText, CheckCircle, AlertCircle, Edit2, Trash2, Plus, Save, ArrowRight } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [tokens, setTokens] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  
  // States for processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  
  // States for final creation
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedTokens = localStorage.getItem('google_tokens');
    if (storedTokens) {
      setTokens(JSON.parse(storedTokens));
      setUser({ name: 'Teacher' });
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_SUCCESS') {
        const { tokens } = event.data;
        setTokens(tokens);
        localStorage.setItem('google_tokens', JSON.stringify(tokens));
        setUser({ name: 'Teacher' });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get auth URL');
      const { url } = data;
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      window.open(url, 'google_login', `width=${width},height=${height},top=${top},left=${left}`);
    } catch (err: any) {
      alert(`Login Error: ${err.message}`);
      setError(err.message);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setResult(null);
      setIsReviewing(false);
      setQuestions([]);
    }
  };

  // --- CHUNKING LOGIC ---
  const processFile = async () => {
    if (!file || !tokens) return;
    setIsProcessing(true);
    setError(null);
    setQuestions([]);
    setProgress('Initializing...');

    try {
      let allQuestions: any[] = [];

      if (file.type === 'application/pdf') {
        // PDF Chunking
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuffer);
        const totalPages = pdfDoc.getPageCount();
        const CHUNK_SIZE = 3; // Process 3 pages at a time to avoid Vercel 10s timeout

        for (let i = 0; i < totalPages; i += CHUNK_SIZE) {
          const end = Math.min(i + CHUNK_SIZE, totalPages);
          setProgress(`Processing pages ${i + 1} to ${end} of ${totalPages}...`);

          // Create a new PDF for this chunk
          const subPdf = await PDFDocument.create();
          const pages = await subPdf.copyPages(pdfDoc, Array.from({ length: end - i }, (_, k) => i + k));
          pages.forEach(page => subPdf.addPage(page));
          const pdfBytes = await subPdf.save();
          
          // Upload chunk
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const formData = new FormData();
          formData.append('file', blob, `chunk_${i}.pdf`);

          const res = await fetch('/api/parse', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokens.access_token}` },
            body: formData
          });

          if (!res.ok) throw new Error(`Failed to process chunk ${i/CHUNK_SIZE + 1}`);
          const data = await res.json();
          if (data.questions) {
            allQuestions = [...allQuestions, ...data.questions];
          }
        }
      } else {
        // Word Document (No client-side chunking yet, send as is)
        setProgress('Processing document...');
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokens.access_token}` },
          body: formData
        });

        if (!res.ok) throw new Error('Failed to process document');
        const data = await res.json();
        if (data.questions) {
          allQuestions = data.questions;
        }
      }

      if (allQuestions.length === 0) {
        throw new Error('No questions were found in the document.');
      }

      setQuestions(allQuestions);
      setIsReviewing(true); // Move to Review Stage

    } catch (err: any) {
      console.error('Processing error', err);
      setError(err.message);
    } finally {
      setIsProcessing(false);
      setProgress('');
    }
  };

  // --- REVIEW LOGIC ---
  const updateQuestion = (index: number, field: string, value: any) => {
    const newQuestions = [...questions];
    newQuestions[index] = { ...newQuestions[index], [field]: value };
    setQuestions(newQuestions);
  };

  const deleteQuestion = (index: number) => {
    const newQuestions = questions.filter((_, i) => i !== index);
    setQuestions(newQuestions);
  };

  // --- FINAL CREATION ---
  const createForm = async () => {
    if (!tokens) return;
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/create-form', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokens.access_token}`
        },
        body: JSON.stringify({
          title: file?.name.replace(/\.[^/.]+$/, "") || 'Generated Quiz',
          questions: questions
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create form');

      setResult(data);
      setIsReviewing(false); // Done
    } catch (err: any) {
      console.error('Creation error', err);
      setError(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-indigo-600" />
          <h1 className="text-xl font-semibold tracking-tight">QuizConverter AI</h1>
        </div>
        {user && <div className="text-sm font-medium text-slate-600">Teacher Mode</div>}
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {!user ? (
          <div className="text-center py-20">
            <h2 className="text-3xl font-bold mb-6">Transform Exams into Google Forms</h2>
            <button onClick={handleLogin} className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
              Sign in with Google
            </button>
          </div>
        ) : (
          <>
            {/* STAGE 1: UPLOAD */}
            {!isReviewing && !result && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
                  <div className="border-2 border-dashed border-slate-200 rounded-xl p-10 hover:border-indigo-400 transition-colors relative cursor-pointer">
                    <input type="file" accept=".docx,.pdf" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <Upload className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-lg font-medium text-slate-700">{file ? file.name : "Upload Exam File"}</p>
                    <p className="text-sm text-slate-500 mt-2">PDF (Auto-chunking supported) or Word</p>
                  </div>

                  {file && (
                    <button
                      onClick={processFile}
                      disabled={isProcessing}
                      className="mt-6 w-full py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                    >
                      {isProcessing ? <><Loader2 className="animate-spin w-5 h-5" /> {progress}</> : "Analyze Document"}
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {/* STAGE 2: REVIEW */}
            {isReviewing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold">Review Questions ({questions.length})</h2>
                  <button
                    onClick={createForm}
                    disabled={isCreating}
                    className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2 shadow-lg shadow-emerald-200"
                  >
                    {isCreating ? <Loader2 className="animate-spin w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                    {isCreating ? "Creating Form..." : "Export to Google Form"}
                  </button>
                </div>

                <div className="space-y-6">
                  {questions.map((q, i) => (
                    <motion.div key={i} layout className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 group">
                      <div className="flex justify-between items-start gap-4 mb-4">
                        <div className="flex-1">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">Question {i + 1}</label>
                          <textarea
                            value={q.title}
                            onChange={(e) => updateQuestion(i, 'title', e.target.value)}
                            className="w-full p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-medium text-lg"
                            rows={2}
                          />
                        </div>
                        <button onClick={() => deleteQuestion(i)} className="text-slate-400 hover:text-red-500 p-2">
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>

                      {q.type === 'MULTIPLE_CHOICE' && (
                        <div className="space-y-2 pl-4 border-l-2 border-slate-100">
                          {q.options?.map((opt: string, optIdx: number) => (
                            <div key={optIdx} className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border border-slate-300 flex-shrink-0" />
                              <input
                                type="text"
                                value={opt}
                                onChange={(e) => {
                                  const newOptions = [...q.options];
                                  newOptions[optIdx] = e.target.value;
                                  updateQuestion(i, 'options', newOptions);
                                }}
                                className="flex-1 p-1.5 border border-slate-100 rounded hover:border-slate-300 focus:border-indigo-500 text-sm"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* STAGE 3: SUCCESS */}
            {result && (
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="max-w-xl mx-auto text-center bg-emerald-50 border border-emerald-100 p-10 rounded-3xl">
                <CheckCircle className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
                <h2 className="text-3xl font-bold text-emerald-900 mb-2">Success!</h2>
                <p className="text-emerald-700 mb-8">Your quiz has been created in Google Forms.</p>
                <div className="flex gap-4 justify-center">
                  <a href={result.editUrl} target="_blank" className="px-6 py-3 bg-white text-emerald-700 border border-emerald-200 rounded-xl font-medium hover:bg-emerald-100">Edit Form</a>
                  <a href={result.formUrl} target="_blank" className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 shadow-lg">View Live</a>
                </div>
                <button onClick={() => { setResult(null); setFile(null); }} className="mt-8 text-emerald-600 hover:underline text-sm">Convert another file</button>
              </motion.div>
            )}

            {/* ERROR TOAST */}
            {error && (
              <div className="fixed bottom-6 right-6 bg-red-600 text-white p-4 rounded-xl shadow-xl flex items-center gap-3 max-w-md animate-in slide-in-from-bottom-10">
                <AlertCircle className="w-6 h-6 flex-shrink-0" />
                <p className="text-sm font-medium">{error}</p>
                <button onClick={() => setError(null)} className="ml-auto text-white/80 hover:text-white">✕</button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
