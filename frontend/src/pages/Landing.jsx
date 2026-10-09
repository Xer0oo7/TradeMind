import { Link } from 'react-router-dom';
import { TrendingUp, DollarSign, BarChart3, MessageSquare, Cpu, Zap, Target, ArrowRight, Settings } from 'lucide-react';
import Layout from '../components/Layout';
import NeoCard from '../components/NeoCard';
import NeoButton from '../components/NeoButton';
import AlertBanner from '../components/AlertBanner';
import { useI18n } from '../context/I18nContext';

export default function Landing() {
  const { t } = useI18n();

  const roleCards = [
    {
      title: t('landing.roleCards.reporter.title'),
      description: t('landing.roleCards.reporter.description'),
      icon: TrendingUp,
      color: 'bg-neo-teal',
      textLight: true,
      path: '/reporter',
      number: '01',
    },
    {
      title: t('landing.roleCards.authority.title'),
      description: t('landing.roleCards.authority.description'),
      icon: Target,
      color: 'bg-neo-orange',
      path: '/authority',
      number: '02',
    },
    {
      title: t('landing.roleCards.jury.title'),
      description: t('landing.roleCards.jury.description'),
      icon: BarChart3,
      color: 'bg-neo-maroon',
      textLight: true,
      path: '/jury',
      number: '03',
    },
  ];

  const stats = [
    { value: '100%', label: t('landing.stats.anonymous') },
    { value: 'AI', label: t('landing.stats.encrypted') },
    { value: '24/7', label: t('landing.stats.available') },
    { value: 'Zero', label: t('landing.stats.zeroData') },
  ];

  const howItWorksSteps = [
    { step: 1, title: t('landing.howItWorks.step1Title'), desc: t('landing.howItWorks.step1Desc') },
    { step: 2, title: t('landing.howItWorks.step2Title'), desc: t('landing.howItWorks.step2Desc') },
    { step: 3, title: t('landing.howItWorks.step3Title'), desc: t('landing.howItWorks.step3Desc') },
    { step: 4, title: t('landing.howItWorks.step4Title'), desc: t('landing.howItWorks.step4Desc') },
  ];

  return (
    <Layout>
      {/* Hero Section - Full viewport height to push banner to bottom half */}
      <section className="relative overflow-hidden bg-neo-cream">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 left-10 w-32 h-32 border-[4px] border-neo-navy rotate-12"></div>
          <div className="absolute top-40 right-20 w-24 h-24 border-[4px] border-neo-teal -rotate-6"></div>
          <div className="absolute bottom-20 left-1/4 w-16 h-16 bg-neo-orange"></div>
          <div className="absolute bottom-40 right-1/3 w-20 h-20 bg-neo-teal rotate-45"></div>
        </div>

        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Column - Text */}
            <div className="relative z-10">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 neo-badge-teal mb-6">
                <Cpu className="w-4 h-4" />
                <span>{t('landing.badge')}</span>
              </div>

              {/* Main Heading */}
              <h1 className="text-5xl sm:text-7xl md:text-9xl font-heading font-bold mb-4 leading-none text-neo-navy">
                PEI
                <span className="block text-neo-orange relative">
                  THO
                  <svg className="absolute -bottom-2 left-0 w-full h-4" viewBox="0 0 200 20">
                    <path d="M0 10 Q50 0, 100 10 T200 10" stroke="#FF7D00" strokeWidth="4" fill="none" />
                  </svg>
                </span>
              </h1>

              {/* Subheading */}
              <p className="text-2xl md:text-3xl font-heading font-bold mb-4 text-neo-navy">
                {t('landing.tagline')}
              </p>

              {/* Description */}
              <p className="text-lg text-neo-navy/70 mb-4 max-w-md">
                {t('landing.description')}
              </p>
              <p className="text-lg font-bold text-neo-navy mb-8 max-w-md">
                {t('landing.notAChatbot')}
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Link to="/api-access">
                  <NeoButton variant="orange" size="lg">
                    <DollarSign className="w-5 h-5 mr-2" />
                    {t('landing.startReporting')}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </NeoButton>
                </Link>
                <Link to="/chat">
                  <NeoButton variant="navy" size="lg">
                    <MessageSquare className="w-5 h-5 mr-2" />
                    {t('landing.whatsApp')}
                  </NeoButton>
                </Link>
              </div>
            </div>

            {/* Right Column - Visual Element */}
            <div className="relative hidden lg:block">
              {/* Stacked Cards Visual */}
              <div className="relative animate-float">
                {/* Back card */}
                <div className="absolute top-8 left-8 w-full h-80 bg-neo-navy border-[4px] border-neo-navy"></div>
                {/* Middle card */}
                <div className="absolute top-4 left-4 w-full h-80 bg-neo-teal border-[4px] border-neo-navy"></div>
                {/* Front card */}
                <div className="relative w-full h-80 bg-neo-orange border-[4px] border-neo-navy p-8 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 bg-neo-navy flex items-center justify-center">
                        <TrendingUp className="w-6 h-6 text-neo-cream" />
                      </div>
                      <span className="font-heading font-bold text-xl text-neo-navy">{t('landing.secureReport')}</span>
                    </div>
                    <div className="space-y-2">
                      <div className="h-4 bg-neo-navy/20 w-full"></div>
                      <div className="h-4 bg-neo-navy/20 w-3/4"></div>
                      <div className="h-4 bg-neo-navy/20 w-5/6"></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-mono text-neo-navy/60">MAX_PROFIT</span>
                    <div className="neo-badge-navy">
                      <Cpu className="w-3 h-3 mr-1" />
                      AI-POWERED
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Alert Banner - positioned at bottom of hero (bottom half of viewport) */}
        <AlertBanner />
      </section>

      {/* Stats Bar */}
      <section className="bg-neo-navy border-y-[4px] border-neo-navy">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x-[2px] divide-neo-teal/30">
            {stats.map((stat, i) => (
              <div key={i} className="py-8 text-center">
                <p className="text-4xl md:text-5xl font-heading font-bold text-neo-orange">{stat.value}</p>
                <p className="text-neo-cream/70 uppercase text-sm tracking-wider">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Role Cards */}
      <section className="py-16 md:py-24 bg-neo-cream">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <span className="neo-badge-orange mb-4">{t('landing.roleCards.chooseYourPath')}</span>
            <h2 className="text-4xl md:text-5xl font-heading font-bold text-neo-navy">
              {t('landing.roleCards.threeRolesOneMission')}
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {roleCards.map((role) => (
              <Link
                key={role.title}
                to={role.path}
                className={`
                  group relative border-[4px] border-neo-navy ${role.color} p-6 
                  transition-all duration-200 shadow-neo
                  hover:translate-x-[4px] hover:translate-y-[4px] hover:shadow-none
                `}
              >
                {/* Number */}
                <span className={`absolute top-4 right-4 text-6xl font-heading font-bold opacity-20 ${role.textLight ? 'text-neo-cream' : 'text-neo-navy'}`}>
                  {role.number}
                </span>

                {/* Icon */}
                <div className={`
                  w-16 h-16 border-[3px] border-neo-navy flex items-center justify-center mb-6
                  ${role.textLight ? 'bg-neo-cream text-neo-navy' : 'bg-neo-navy text-neo-cream'}
                `}>
                  <role.icon className="w-8 h-8" />
                </div>

                {/* Content */}
                <h3 className={`text-2xl font-heading font-bold mb-2 ${role.textLight ? 'text-neo-cream' : 'text-neo-navy'}`}>
                  {role.title}
                </h3>
                <p className={`text-sm mb-4 ${role.textLight ? 'text-neo-cream/80' : 'text-neo-navy/70'}`}>
                  {role.description}
                </p>

                {/* Arrow */}
                <div className={`flex items-center gap-2 font-bold text-sm uppercase ${role.textLight ? 'text-neo-cream' : 'text-neo-navy'}`}>
                  {t('landing.roleCards.enterDashboard')}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-2 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 md:py-24 border-t-[4px] border-neo-navy bg-neo-teal">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row gap-12 items-start">
            {/* Left - Title */}
            <div className="md:w-1/3 md:sticky md:top-8">
              <span className="neo-badge-orange mb-4">{t('landing.features.securityFirst')}</span>
              <h2 className="text-4xl md:text-5xl font-heading font-bold mb-4 text-neo-cream">
                {t('landing.features.builtForZeroTrust')}
              </h2>
              <p className="text-neo-cream/70">
                {t('landing.features.privacyPriority')}
              </p>
            </div>

            {/* Right - Feature Cards */}
            <div className="md:w-2/3 grid sm:grid-cols-2 gap-4">
              <NeoCard className="p-6">
                <div className="w-14 h-14 bg-neo-orange border-[3px] border-neo-navy flex items-center justify-center mb-4">
                  <Zap className="w-7 h-7 text-neo-navy" />
                </div>
                <h3 className="text-xl font-heading font-bold mb-2 text-neo-navy">{t('landing.features.clientSideEncryption')}</h3>
                <p className="text-neo-navy/70 text-sm">
                  {t('landing.features.clientSideEncryptionDesc')}
                </p>
              </NeoCard>

              <NeoCard className="p-6">
                <div className="w-14 h-14 bg-neo-navy border-[3px] border-neo-navy flex items-center justify-center mb-4">
                  <Settings className="w-7 h-7 text-neo-cream" />
                </div>
                <h3 className="text-xl font-heading font-bold mb-2 text-neo-navy">{t('landing.features.sessionBasedIdentity')}</h3>
                <p className="text-neo-navy/70 text-sm">
                  {t('landing.features.sessionBasedIdentityDesc')}
                </p>
              </NeoCard>

              <NeoCard className="p-6">
                <div className="w-14 h-14 bg-neo-maroon border-[3px] border-neo-navy flex items-center justify-center mb-4">
                  <BarChart3 className="w-7 h-7 text-neo-cream" />
                </div>
                <h3 className="text-xl font-heading font-bold mb-2 text-neo-navy">{t('landing.features.ipfsBlockchain')}</h3>
                <p className="text-neo-navy/70 text-sm">
                  {t('landing.features.ipfsBlockchainDesc')}
                </p>
              </NeoCard>

              <NeoCard className="p-6">
                <div className="w-14 h-14 bg-neo-orange border-[3px] border-neo-navy flex items-center justify-center mb-4">
                  <Target className="w-7 h-7 text-neo-navy" />
                </div>
                <h3 className="text-xl font-heading font-bold mb-2 text-neo-navy">{t('landing.features.authorityOnlyDecryption')}</h3>
                <p className="text-neo-navy/70 text-sm">
                  {t('landing.features.authorityOnlyDecryptionDesc')}
                </p>
              </NeoCard>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 md:py-24 bg-neo-navy text-neo-cream">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <span className="neo-badge-orange mb-4">{t('landing.howItWorks.simpleProcess')}</span>
            <h2 className="text-4xl md:text-5xl font-heading font-bold">
              {t('landing.howItWorks.title')}
            </h2>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="relative">
              {/* Timeline Line */}
              <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-[4px] bg-neo-orange transform md:-translate-x-1/2"></div>

              {/* Steps */}
              {howItWorksSteps.map((item, i) => (
                <div key={item.step} className={`relative flex items-center gap-6 mb-12 ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}>
                  {/* Step Number */}
                  <div className="absolute left-0 md:left-1/2 transform md:-translate-x-1/2 w-16 h-16 bg-neo-orange border-[4px] border-neo-cream flex items-center justify-center z-10">
                    <span className="font-heading font-bold text-2xl text-neo-navy">{item.step}</span>
                  </div>

                  {/* Content */}
                  <div className={`ml-24 md:ml-0 md:w-[calc(50%-3rem)] ${i % 2 === 0 ? 'md:pr-12 md:text-right' : 'md:pl-12'}`}>
                    <h3 className="text-xl font-heading font-bold mb-2 text-neo-orange">{item.title}</h3>
                    <p className="text-neo-cream/70">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24 bg-neo-orange border-t-[4px] border-neo-navy">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl md:text-6xl font-heading font-bold mb-6 text-neo-navy">
            {t('landing.cta.readyToReport')}
          </h2>
          <p className="text-xl mb-8 max-w-2xl mx-auto text-neo-navy/80">
            {t('landing.cta.safetyPriority')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/api-access">
              <NeoButton variant="navy" size="lg">
                <DollarSign className="w-5 h-5 mr-2" />
                {t('landing.cta.createAnonymousReport')}
              </NeoButton>
            </Link>
            <Link to="/wallet">
              <NeoButton size="lg">
                {t('landing.cta.authorityLogin')}
              </NeoButton>
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
