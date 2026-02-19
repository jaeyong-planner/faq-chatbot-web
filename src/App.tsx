import { useState, useEffect } from 'react';
import type { FAQ, Page } from './types';
import { useAuth } from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import FaqManagement from './components/FaqManagement';
import DocumentManagement from './components/DocumentManagement';
import ChunkManagement from './components/ChunkManagement';
import ChatLogs from './components/ChatLogs';
import ChatLogAnalysis from './components/ChatLogAnalysis';
import SystemSettings from './components/SystemSettings';
import UserChatbot from './components/UserChatbot';

function App() {
  const { user, loading, signOut } = useAuth();
  const isAdminPath = window.location.pathname.startsWith('/admin');
  const [currentView, setCurrentView] = useState<'login' | 'admin' | 'chatbot'>(
    isAdminPath ? 'login' : 'chatbot'
  );
  const [currentPage, setCurrentPage] = useState<Page>('대시보드');
  const [faqs, setFaqs] = useState<FAQ[]>([]);

  // Auth state + pathname → view switching
  useEffect(() => {
    const onAdminPath = window.location.pathname.startsWith('/admin');
    if (!onAdminPath) {
      setCurrentView('chatbot');
      return;
    }
    if (user) {
      setCurrentView('admin');
    } else if (!loading) {
      setCurrentView('login');
    }
  }, [user, loading]);

  const handleLogout = async () => {
    await signOut();
    setCurrentView('login');
    setCurrentPage('대시보드');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  // Chatbot view (public)
  if (currentView === 'chatbot') {
    return (
      <ErrorBoundary>
        <ToastProvider>
          <UserChatbot />
        </ToastProvider>
      </ErrorBoundary>
    );
  }

  // Login view
  if (currentView === 'login' || !user) {
    return (
      <ErrorBoundary>
        <ToastProvider>
          <Login onLogin={(success) => { if (success) setCurrentView('admin'); }} />
        </ToastProvider>
      </ErrorBoundary>
    );
  }

  // Admin panel with sidebar
  const renderPage = () => {
    switch (currentPage) {
      case '대시보드': return <Dashboard onNavigateToChatLogs={() => setCurrentPage('채팅 로그')} />;
      case '엠브레인Agent관리': return <FaqManagement faqs={faqs} setFaqs={setFaqs} />;
      case '문서 관리': return <DocumentManagement setFaqs={setFaqs} />;
      case '청크 관리': return <ChunkManagement />;
      case '채팅 로그': return <ChatLogs />;
      case '채팅 분석': return <ChatLogAnalysis />;
      case '시스템 설정': return <SystemSettings />;
      default: return <Dashboard onNavigateToChatLogs={() => setCurrentPage('채팅 로그')} />;
    }
  };

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="min-h-screen bg-gray-50">
          <Sidebar
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            onLogout={handleLogout}
          />
          <main className="lg:ml-64 min-h-screen overflow-auto">
            {renderPage()}
          </main>
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
