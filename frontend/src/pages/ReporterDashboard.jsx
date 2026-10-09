import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus, Play, BarChart3, Code, Hash, TrendingUp, Cpu,
  Copy, Check, ArrowRight, Clock, CheckCircle, XCircle, Zap, Loader2
} from 'lucide-react';
import Layout from '../components/Layout';
import NeoCard from '../components/NeoCard';
import NeoButton from '../components/NeoButton';
import { useI18n } from '../context/I18nContext';
import { useSession } from '../context/SessionContext';
import { getReporterStats, getReporterReports } from '../lib/api';

export default function ReporterDashboard() {
  const { t } = useI18n();
  const { session, sessionId, walletAddress, createNewSession, loading: sessionLoading } = useSession();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    reportCount: 0,
    stakeUsed: '0 ETH',
    reputationScore: 0,
    pendingRewards: '0 ETH',
  });
  const [recentReports, setRecentReports] = useState([]);

  useEffect(() => {
    async function loadData() {
      // Wait for session context to load
      if (sessionLoading) return;

      try {
        const wallet = walletAddress;

        // If no wallet/session, user needs to create one
        if (!wallet) {
          console.log('No wallet found - user needs to create a new session');
          setLoading(false);
          return;
        }

        // Fetch stats if we have a wallet
        const statsRes = await getReporterStats(wallet);
        if (!statsRes.error) {
          setStats(statsRes);
        }

        // Fetch recent reports
        const reportsRes = await getReporterReports(wallet, 5);
        if (Array.isArray(reportsRes)) {
          setRecentReports(reportsRes);
        }
      } catch (error) {
        console.error('Failed to load reporter data:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [sessionLoading, walletAddress]);

  const copySessionId = () => {
    if (sessionId) {
      navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      verified: { bg: 'bg-neo-teal', icon: CheckCircle, label: t('common.verified') },
      pending: { bg: 'bg-neo-orange', icon: Clock, label: t('common.pending') },
      under_review: { bg: 'bg-neo-orange', icon: Clock, label: 'Pending' },
      rejected: { bg: 'bg-neo-maroon', icon: XCircle, label: t('common.rejected') },
    };
    const badge = badges[status] || badges.pending;
    const Icon = badge.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase ${badge.bg} ${status === 'pending' || status === 'under_review' ? 'text-neo-navy' : 'text-neo-cream'} border-[2px] border-neo-navy`}>
        <Icon className="w-3 h-3" />
        {badge.label}
      </span>
    );
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-neo-teal" />
        </div>
      </Layout>
    );
  }

  // Show prompt to generate session if no wallet/session exists
  if (!walletAddress || !sessionId) {
    return (
      <Layout>
        <div className="min-h-[80vh] flex items-center justify-center p-4 bg-neo-navy">
          <NeoCard className="p-8 text-center max-w-md">
            <div className="w-20 h-20 bg-neo-teal border-[3px] border-neo-navy flex items-center justify-center mx-auto mb-6">
              <TrendingUp className="w-10 h-10 text-neo-cream" />
            </div>
            <h2 className="text-3xl font-heading font-bold mb-2 text-neo-navy">Welcome to Peitho</h2>
            <p className="text-neo-navy/70 mb-6">
              Start your first negotiation session to begin using the AI-powered pricing engine.
            </p>
            <NeoCard variant="teal" className="p-4 mb-6 text-left">
              <p className="text-neo-cream text-sm font-bold mb-2">How to get started:</p>
              <ol className="text-neo-cream/80 text-sm space-y-2">
                <li>1. Create a new negotiation session</li>
                <li>2. Define your product and pricing rules</li>
                <li>3. Let Peitho handle negotiations</li>
              </ol>
            </NeoCard>
            <Link to="/">
              <NeoButton variant="orange" className="w-full">
                Back to Home
              </NeoButton>
            </Link>
          </NeoCard>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Hero Header */}
      <section className="bg-neo-navy py-6 sm:py-12 border-b-[4px] border-neo-navy">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col gap-4 sm:gap-6">
              <div>
                <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-neo-cream mb-2">
                  {t('reporterHome.title')}
                </h1>
                <p className="text-sm sm:text-base text-neo-cream/60">
                  {t('reporterHome.subtitle')}
                </p>
              </div>

              {/* Session ID */}
              <NeoCard className="p-3 sm:p-4 bg-neo-teal border-neo-teal w-full sm:w-auto sm:self-start">
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 bg-neo-orange flex items-center justify-center flex-shrink-0">
                    <Hash className="w-4 h-4 sm:w-5 sm:h-5 text-neo-navy" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] sm:text-xs text-neo-cream/70 uppercase">{t('common.session')}</p>
                    <p className="font-mono font-bold text-neo-cream text-sm sm:text-base truncate">{sessionId}</p>
                  </div>
                  <button
                    onClick={copySessionId}
                    className="p-2 hover:bg-neo-navy/20 transition-colors flex-shrink-0"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 sm:w-5 sm:h-5 text-neo-orange" />
                    ) : (
                      <Copy className="w-4 h-4 sm:w-5 sm:h-5 text-neo-cream" />
                    )}
                  </button>
                </div>
              </NeoCard>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-neo-cream border-b-[4px] border-neo-navy">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4">
            <div className="py-3 sm:py-6 text-center border-r-[2px] border-b-[2px] md:border-b-0 border-neo-navy">
              <p className="text-2xl sm:text-4xl font-heading font-bold text-neo-navy">{stats.reportCount}</p>
              <p className="text-xs sm:text-sm text-neo-navy/60">{t('common.reports')}</p>
            </div>
            <div className="py-3 sm:py-6 text-center border-b-[2px] md:border-b-0 md:border-r-[2px] border-neo-navy">
              <p className="text-2xl sm:text-4xl font-heading font-bold text-neo-teal">{stats.stakeUsed}</p>
              <p className="text-xs sm:text-sm text-neo-navy/60">{t('common.stakeUsed')}</p>
            </div>
            <div className="py-3 sm:py-6 text-center border-r-[2px] border-neo-navy">
              <p className="text-2xl sm:text-4xl font-heading font-bold text-neo-orange">{stats.reputationScore}</p>
              <p className="text-xs sm:text-sm text-neo-navy/60">{t('common.reputation')}</p>
            </div>
            <div className="py-3 sm:py-6 text-center">
              <p className="text-2xl sm:text-4xl font-heading font-bold text-neo-teal">{stats.pendingRewards}</p>
              <p className="text-xs sm:text-sm text-neo-navy/60">{t('common.pendingRewards')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-6 sm:py-12 bg-neo-cream">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="grid lg:grid-cols-3 gap-6 sm:gap-8">
              {/* Actions Column */}
              <div className="lg:col-span-2 space-y-4 sm:space-y-6">
                <h2 className="text-xl sm:text-2xl font-heading font-bold text-neo-navy mb-2 sm:mb-4">{t('reporterHome.quickActions')}</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {/* Create Report */}
                  <Link to={`/reporter/report?session=${sessionId}`}>
                    <NeoCard variant="orange" hover className="p-4 sm:p-6 h-full">
                      <div className="flex flex-col h-full">
                        <div className="w-10 h-10 sm:w-14 sm:h-14 bg-neo-navy border-[2px] sm:border-[3px] border-neo-navy flex items-center justify-center mb-3 sm:mb-4">
                          <Plus className="w-5 h-5 sm:w-7 sm:h-7 text-neo-cream" />
                        </div>
                        <h3 className="text-lg sm:text-xl font-heading font-bold text-neo-navy mb-1 sm:mb-2">{t('reporterHome.createReport.title')}</h3>
                        <p className="text-xs sm:text-sm text-neo-navy/70 mb-3 sm:mb-4 flex-grow">{t('reporterHome.createReport.description')}</p>
                        <div className="flex items-center gap-2 text-neo-navy font-bold text-xs sm:text-sm">
                          {t('reporterHome.createReport.action')} <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
                        </div>
                      </div>
                    </NeoCard>
                  </Link>

                  {/* Silent Report */}
                  <Link to="/reporter/silent">
                    <NeoCard variant="teal" hover className="p-4 sm:p-6 h-full">
                      <div className="flex flex-col h-full">
                        <div className="w-10 h-10 sm:w-14 sm:h-14 bg-neo-cream border-[2px] sm:border-[3px] border-neo-navy flex items-center justify-center mb-3 sm:mb-4">
                          <Play className="w-5 h-5 sm:w-7 sm:h-7 text-neo-navy" />
                        </div>
                        <h3 className="text-lg sm:text-xl font-heading font-bold text-neo-cream mb-1 sm:mb-2">{t('reporterHome.silentReport.title')}</h3>
                        <p className="text-xs sm:text-sm text-neo-cream/80 mb-3 sm:mb-4 flex-grow">{t('reporterHome.silentReport.description')}</p>
                        <div className="flex items-center gap-2 text-neo-cream font-bold text-xs sm:text-sm">
                          {t('reporterHome.silentReport.action')} <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
                        </div>
                      </div>
                    </NeoCard>
                  </Link>

                  {/* Reputation */}
                  <Link to="/authority">
                    <NeoCard hover className="p-4 sm:p-6 h-full">
                      <div className="flex flex-col h-full">
                        <div className="w-10 h-10 sm:w-14 sm:h-14 bg-neo-teal border-[2px] sm:border-[3px] border-neo-navy flex items-center justify-center mb-3 sm:mb-4">
                          <BarChart3 className="w-5 h-5 sm:w-7 sm:h-7 text-neo-cream" />
                        </div>
                        <h3 className="text-lg sm:text-xl font-heading font-bold text-neo-navy mb-1 sm:mb-2">{t('reporterHome.myReputation.title')}</h3>
                        <p className="text-xs sm:text-sm text-neo-navy/70 mb-3 sm:mb-4 flex-grow">{t('reporterHome.myReputation.description')}</p>
                        <div className="flex items-center gap-2 text-neo-navy font-bold text-xs sm:text-sm">
                          {t('reporterHome.myReputation.action')} <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
                        </div>
                      </div>
                    </NeoCard>
                  </Link>

                  {/* Wallet */}
                  <Link to="/wallet">
                    <NeoCard hover className="p-4 sm:p-6 h-full">
                      <div className="flex flex-col h-full">
                        <div className="w-10 h-10 sm:w-14 sm:h-14 bg-neo-orange border-[2px] sm:border-[3px] border-neo-navy flex items-center justify-center mb-3 sm:mb-4">
                          <Code className="w-5 h-5 sm:w-7 sm:h-7 text-neo-navy" />
                        </div>
                        <h3 className="text-lg sm:text-xl font-heading font-bold text-neo-navy mb-1 sm:mb-2">{t('reporterHome.rewards.title')}</h3>
                        <p className="text-xs sm:text-sm text-neo-navy/70 mb-3 sm:mb-4 flex-grow">{t('reporterHome.rewards.description')}</p>
                        <div className="flex items-center gap-2 text-neo-navy font-bold text-xs sm:text-sm">
                          {t('reporterHome.rewards.action')} <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
                        </div>
                      </div>
                    </NeoCard>
                  </Link>
                </div>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Recent Reports */}
                <NeoCard className="overflow-hidden">
                  <div className="p-4 bg-neo-navy">
                    <h3 className="font-heading font-bold text-neo-cream">{t('reporterHome.recentReports')}</h3>
                  </div>
                  <div className="divide-y-[2px] divide-neo-navy">
                    {recentReports.map((report) => (
                      <div key={report.id} className="p-4 hover:bg-neo-cream/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-sm font-bold text-neo-navy">{report.id}</span>
                          {getStatusBadge(report.status)}
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-neo-navy/60">{report.category} • {report.date}</span>
                          <span className={`font-bold ${report.reward.startsWith('-') ? 'text-neo-maroon' : report.reward === '-' ? 'text-neo-navy/50' : 'text-neo-teal'}`}>
                            {report.reward}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t-[2px] border-neo-navy">
                    <Link to="/reporter/history" className="text-sm font-bold text-neo-teal hover:text-neo-orange">
                      {t('reporterHome.viewAllReports')}
                    </Link>
                  </div>
                </NeoCard>

                {/* Quick Tips */}
                <NeoCard variant="navy" className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-neo-orange flex items-center justify-center">
                      <Zap className="w-5 h-5 text-neo-navy" />
                    </div>
                    <h3 className="font-heading font-bold text-neo-cream">{t('reporterHome.earnMore')}</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-neo-cream/80">
                    <li className="flex items-start gap-2">
                      <span className="text-neo-orange">•</span>
                      <span>{t('reporterHome.tip1')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-neo-orange">•</span>
                      <span>{t('reporterHome.tip2')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-neo-orange">•</span>
                      <span>{t('reporterHome.tip3')}</span>
                    </li>
                  </ul>
                </NeoCard>
              </div>
            </div>

            {/* Privacy Banner */}
            <NeoCard variant="maroon" className="p-4 sm:p-6 mt-6 sm:mt-8">
              <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-neo-cream border-[2px] sm:border-[3px] border-neo-cream flex items-center justify-center flex-shrink-0">
                  <Cpu className="w-5 h-5 sm:w-6 sm:h-6 text-neo-maroon" />
                </div>
                <div>
                  <h4 className="font-heading font-bold text-neo-cream mb-1 sm:mb-2 text-sm sm:text-base">{t('reporterHome.privacyProtected')}</h4>
                  <p className="text-neo-cream/80 text-xs sm:text-sm">
                    {t('reporterHome.privacyMessage')}
                  </p>
                </div>
              </div>
            </NeoCard>
          </div>
        </div>
      </section>
    </Layout>
  );
}
