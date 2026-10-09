import { TrendingUp, Github, Twitter } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../context/I18nContext';

export default function Footer() {
  const { t } = useI18n();

  return (
    <footer className="bg-neo-navy text-neo-cream border-t-[3px] border-neo-navy">
      <div className="container mx-auto px-4 py-8">
        <div className="grid md:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="bg-neo-orange border-[2px] border-neo-cream p-1.5">
                <TrendingUp className="w-5 h-5 text-neo-navy" />
              </div>
              <span className="font-heading text-xl font-bold">
                PEI<span className="text-neo-orange">THO</span>
              </span>
            </div>
            <p className="text-neo-cream/60 text-sm">
              {t('footer.description')}
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-heading font-bold text-neo-orange mb-4 uppercase">{t('footer.quickLinks')}</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/reporter" className="hover:text-neo-orange transition-colors">
                  {t('footer.startReporting')}
                </Link>
              </li>
              <li>
                <Link to="/authority" className="hover:text-neo-orange transition-colors">
                  {t('footer.authorityDashboard')}
                </Link>
              </li>
              <li>
                <Link to="/wallet" className="hover:text-neo-orange transition-colors">
                  {t('footer.checkReputation')}
                </Link>
              </li>
            </ul>
          </div>

          {/* // Disclaimer */}
          {/* <div>
            <h4 className="font-heading font-bold text-neo-orange mb-4 uppercase">{t('footer.disclaimer')}</h4>
            <p className="text-neo-cream/60 text-sm">
              {t('footer.disclaimerText')}
            </p>
          </div> */}
        </div>

        <div className="neo-divider bg-neo-teal/30 my-8"></div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-neo-cream/50 text-sm">
            {t('footer.copyright')}
          </p>
          <div className="flex items-center gap-4">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-neo-cream/50 hover:text-neo-orange transition-colors">
              <Github className="w-5 h-5" />
            </a>
            <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-neo-cream/50 hover:text-neo-orange transition-colors">
              <Twitter className="w-5 h-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

