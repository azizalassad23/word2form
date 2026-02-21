import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Loader2, Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [tokens, setTokens] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  useEffect(() => {
    // Check for existing tokens in localStorage (optional, for persistence across reloads)
    const storedTokens = localStorage.getItem('google_tokens');
    if (storedTokens) {
      setTokens(JSON.parse(storedTokens));
      setUser({ name: 'Teacher' }); // Placeholder, ideally fetch user info
    }

    // Listen for OAuth success message
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
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to get auth URL');
      }

      const { url } = data;
      const width = 500;
      const height = 600;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      window.open(url, 'google_login', `width=${width},height=${height},top=${top},left=${left}`);
    } catch (err: any) {
      console.error('Login failed', err);
      alert(`Login Error: ${err.message}`); // Show visible error to user
      setError(err.message);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      setPreviewData(null);
      setResult(null);
    }
  };

  const handlePreview = async () => {
    if (!file || !tokens) return;

    setIsConverting(true);
    setError(null);
    setPreviewData(null);
    setResult(null);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`
        },
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Parsing failed');
      }

      setPreviewData(data.questions);
    } catch (err: any) {
      console.error('Parsing error', err);
      setError(err.message);
    } finally {
      setIsConverting(false);
    }
  };

  const handlePublish = async () => {
    if (!previewData || !tokens || !file) return;

    setIsPublishing(true);
    setError(null);

    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: file.name.replace(/\.[^/.]+$/, ""),
          questions: previewData
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Publishing failed');
      }

      setResult(data);
      setPreviewData(null); // Clear preview after successful publish
    } catch (err: any) {
      console.error('Publishing error', err);
      setError(err.message);
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-indigo-600" />
          <h1 className="text-xl font-semibold tracking-tight">QuizConverter AI</h1>
        </div>
        {user ? (
          <div className="text-sm font-medium text-slate-600">
            Welcome, Teacher
          </div>
        ) : (
          <button 
            onClick={handleLogin}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Sign in with Google
          </button>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold tracking-tight mb-4">Transform Word & PDF into Google Forms</h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Upload your exam questions and let AI automatically generate a ready-to-use Google Form quiz for your students.
          </p>
        </div>

        {!user ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center">
            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Upload className="w-8 h-8 text-indigo-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Get Started</h3>
            <p className="text-slate-500 mb-8">Sign in to connect your Google Drive and Forms.</p>
            <button 
              onClick={handleLogin}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
            >
              Connect Google Account
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Upload Section */}
            {!previewData && !result && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8"
              >
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-indigo-400 transition-colors cursor-pointer relative">
                  <input 
                    type="file" 
                    accept=".docx,.pdf" 
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="pointer-events-none">
                    <Upload className="w-10 h-10 text-slate-400 mx-auto mb-4" />
                    <p className="text-lg font-medium text-slate-700 mb-1">
                      {file ? file.name : "Drop your exam file here"}
                    </p>
                    <p className="text-sm text-slate-500">
                      Supports .docx and .pdf
                    </p>
                  </div>
                </div>

                {file && (
                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={handlePreview}
                      disabled={isConverting}
                      className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isConverting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          Preview Quiz
                        </>
                      )}
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {/* Preview Section */}
            {previewData && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8"
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-slate-900">Preview Quiz</h3>
                  <span className="text-sm text-slate-500">{previewData.length} Questions Found</span>
                </div>
                
                <div className="space-y-6 mb-8 max-h-[60vh] overflow-y-auto pr-2">
                  {previewData.map((q, idx) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="font-medium text-slate-800 mb-3">
                        <span className="text-indigo-600 mr-2">{idx + 1}.</span>
                        {q.title}
                      </p>
                      <div className="space-y-2 pl-6">
                        {q.options?.map((opt: string, optIdx: number) => (
                          <div key={optIdx} className="flex items-center gap-2 text-sm text-slate-600">
                            <div className="w-4 h-4 rounded-full border border-slate-300 flex-shrink-0" />
                            <span>{opt}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => setPreviewData(null)}
                    className="px-6 py-3 bg-white text-slate-700 border border-slate-200 rounded-xl font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePublish}
                    disabled={isPublishing}
                    className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isPublishing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Publishing...
                      </>
                    ) : (
                      <>
                        Publish to Google Forms
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Error Message */}
            {error && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-red-50 text-red-700 p-4 rounded-xl flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-medium">Error</h4>
                  <p className="text-sm opacity-90">{error}</p>
                </div>
              </motion.div>
            )}

            {/* Success Result */}
            {result && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-emerald-50 border border-emerald-100 p-8 rounded-2xl text-center"
              >
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-2xl font-bold text-emerald-900 mb-2">Quiz Generated!</h3>
                <p className="text-emerald-700 mb-8">Your Google Form is ready to be shared.</p>
                
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <a 
                    href={result.editUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="px-6 py-3 bg-white text-emerald-700 border border-emerald-200 rounded-xl font-medium hover:bg-emerald-50 transition-colors"
                  >
                    Edit Form
                  </a>
                  <a 
                    href={result.formUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200"
                  >
                    View Live Form
                  </a>
                </div>
                
                <button
                  onClick={() => {
                    setResult(null);
                    setFile(null);
                  }}
                  className="mt-8 text-sm text-emerald-600 hover:text-emerald-800 underline"
                >
                  Create Another Quiz
                </button>
              </motion.div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
