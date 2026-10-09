import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { I18nProvider } from './context/I18nContext';
import LanguageModal from './components/LanguageModal';
import TranslationLoadingOverlay from './components/TranslationLoadingOverlay';
import Login from './pages/Login';
import Register from './pages/Register';
import Landing from './pages/Landing';
import ReporterDashboard from './pages/ReporterDashboard';
import ReportSubmission from './pages/ReportSubmission';
import SilentReportComposer from './pages/SilentReportComposer';
import ApiReference from './pages/ApiReference';
import BusinessAnalytics from './pages/BusinessAnalytics';
import NegotiationDashboard from './pages/NegotiationDashboard';
import ReputationDashboard from './pages/ReputationDashboard';
import ProductCatalog from './pages/ProductCatalog';
import ApiAccess from './pages/ApiAccess';
import EmailSettings from './pages/EmailSettings';
import Chat from './test-chat/src/Chat';
import PeithoPage from './peitho/PeithoPage';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <I18nProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SessionProvider>
          <LanguageModal />
          <TranslationLoadingOverlay />
          <Routes>
            {/* Login - Entry Point */}
            <Route path="/login" element={<Login />} />

            {/* Register */}
            <Route path="/register" element={<Register />} />

            {/* Landing */}
            <Route path="/" element={<Landing />} />

            {/* Reporter Routes */}
            <Route path="/reporter" element={<ReporterDashboard />} />
            <Route path="/reporter/report" element={<ReportSubmission />} />
            <Route path="/reporter/silent" element={<SilentReportComposer />} />
            <Route path="/r/:sessionId" element={<ReportSubmission />} />
            <Route path="/report/:sessionId" element={<ReportSubmission />} />

            {/* Wallet */}
            <Route path="/wallet" element={<ApiReference />} />

            {/* Authority */}
            <Route path="/authority" element={<BusinessAnalytics />} />

            {/* Jury (requires login) */}
            <Route path="/jury" element={<ProtectedRoute><NegotiationDashboard /></ProtectedRoute>} />

            {/* Reputation */}
            <Route path="/reputation" element={<ReputationDashboard />} />

            {/* Products (requires login) */}
            <Route path="/products" element={<ProtectedRoute><ProductCatalog /></ProtectedRoute>} />

            {/* API Access (requires login) */}
            <Route path="/api-access" element={<ProtectedRoute><ApiAccess /></ProtectedRoute>} />

            {/* Email Settings (requires login) */}
            <Route path="/email-settings" element={<ProtectedRoute><EmailSettings /></ProtectedRoute>} />

            {/* Chat / Negotiation Demo */}
            <Route path="/chat" element={<Chat />} />

            {/* Meet Assistant (Live Negotiation Copilot) */}
            <Route path="/meet-assistant" element={<PeithoPage />} />
            <Route path="/meet-asistant" element={<PeithoPage />} />
            <Route path="/peitho" element={<Navigate to="/meet-assistant" replace />} />

            {/* 404 Catch-all */}
            <Route path="*" element={
              <div className="min-h-screen bg-neo-cream flex flex-col items-center justify-center p-4 text-center">
                <h1 className="text-6xl sm:text-8xl font-heading font-bold text-neo-navy mb-4">404</h1>
                <p className="text-lg text-neo-navy/70 mb-6">Page not found</p>
                <a href="/" className="px-6 py-3 bg-neo-orange border-[3px] border-neo-navy font-heading font-bold text-neo-navy shadow-neo hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all">
                  Go Home
                </a>
              </div>
            } />
          </Routes>
        </SessionProvider>
      </BrowserRouter>
    </I18nProvider>
  );
}

export default App;

