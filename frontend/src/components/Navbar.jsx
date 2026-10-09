import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Settings, Code, Menu, X, Key, Mail, User, LogOut, ChevronDown, Shield, AlertTriangle, Radio } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useI18n } from '../context/I18nContext';
import { getAuthUser, getAuthToken, logout as apiLogout, isAuthenticated } from '../lib/api';
import faviconSvg from '../assets/favicon.svg';

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { t } = useI18n();
  const userMenuRef = useRef(null);
  const mobileUserMenuRef = useRef(null);

  const loggedIn = isAuthenticated();
  const user = getAuthUser();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Close user menu on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      const insideDesktop = userMenuRef.current && userMenuRef.current.contains(e.target);
      const insideMobile = mobileUserMenuRef.current && mobileUserMenuRef.current.contains(e.target);
      if (!insideDesktop && !insideMobile) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close user menu on route change
  useEffect(() => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    setUserMenuOpen(false);
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    apiLogout();
    setShowLogoutConfirm(false);
    navigate('/login');
  };

  const cancelLogout = () => {
    setShowLogoutConfirm(false);
  };

  const handleDropdownNavigate = (path) => {
    setUserMenuOpen(false);
    navigate(path);
  };

  // Main nav links (removed API & Email — moved to user dropdown)
  const navLinks = [
    { path: '/', label: t('navbar.home'), icon: null },
    { path: '/meet-assistant', label: 'Meet Assistant', icon: Radio },
    { path: '/products', label: 'Products', icon: LayoutDashboard },
    { path: '/authority', label: t('navbar.authority'), icon: BarChart3 },
    { path: '/jury', label: 'Dashboard', icon: BarChart3 },
    { path: '/wallet', label: t('navbar.wallet'), icon: Code },
  ];

  // User dropdown menu items
  const userMenuItems = [
    { path: '/api-access', label: 'API Access', icon: Key },
    { path: '/email-settings', label: 'Email Settings', icon: Mail },
  ];

  // User initials from name/email
  const userInitials = user?.full_name
    ? user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email
      ? user.email[0].toUpperCase()
      : 'U';

  return (
    <nav className="bg-neo-cream border-b-[3px] border-neo-navy">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 flex-shrink-0">
            <img
              src={faviconSvg}
              alt="Peitho Logo"
              className="w-10 h-10 sm:w-12 sm:h-12"
            />
            <span className="font-heading text-xl sm:text-2xl font-bold tracking-tight text-neo-navy">
              PEI<span className="text-neo-orange">THO</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1.5 lg:gap-2">
            {navLinks.map((link) => {
              const isActive = location.pathname === link.path;
              const Icon = link.icon;

              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`
                    px-3 lg:px-4 py-2 font-heading font-bold text-xs lg:text-sm uppercase tracking-wide
                    border-[2px] border-neo-navy transition-all duration-150
                    ${isActive
                      ? 'bg-neo-navy text-neo-cream'
                      : 'bg-neo-cream text-neo-navy hover:bg-neo-orange hover:translate-x-[1px] hover:translate-y-[1px]'
                    }
                  `}
                >
                  <span className="flex items-center gap-1.5">
                    {Icon && <Icon className="w-4 h-4" />}
                    {link.label}
                  </span>
                </Link>
              );
            })}

            {/* User Avatar / Auth Button */}
            {loggedIn ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className={`
                    flex items-center gap-1.5 px-2 py-1.5 font-heading font-bold text-xs uppercase
                    border-[2px] border-neo-navy transition-all duration-150 ml-1
                    ${userMenuOpen
                      ? 'bg-neo-navy text-neo-cream'
                      : 'bg-neo-cream text-neo-navy hover:bg-neo-orange/20'
                    }
                  `}
                >
                  <div className="w-7 h-7 bg-neo-orange border-[2px] border-neo-navy flex items-center justify-center">
                    <span className="text-[10px] font-black text-neo-navy">{userInitials}</span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown */}
                {userMenuOpen && (
                  <div className="absolute right-0 mt-1 w-56 bg-neo-cream border-[3px] border-neo-navy shadow-neo z-50">
                    {/* User Info Header */}
                    <div className="px-3 py-2.5 border-b-[2px] border-neo-navy/15 bg-neo-navy/5">
                      <p className="font-heading font-bold text-xs text-neo-navy truncate">
                        {user?.full_name || 'User'}
                      </p>
                      <p className="text-[10px] text-neo-navy/50 truncate font-mono">
                        {user?.email || ''}
                      </p>
                    </div>

                    {/* Menu Items */}
                    <div className="py-1">
                      {userMenuItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.path}
                            onClick={() => handleDropdownNavigate(item.path)}
                            className={`
                              flex items-center gap-2.5 w-full px-3 py-2 text-xs font-bold uppercase tracking-wide
                              transition-all duration-100
                              ${isActive
                                ? 'bg-neo-navy text-neo-cream'
                                : 'text-neo-navy hover:bg-neo-orange/15 hover:pl-4'
                              }
                            `}
                          >
                            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                            {item.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Logout */}
                    <div className="border-t-[2px] border-neo-navy/15 py-1">
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-bold uppercase tracking-wide text-neo-maroon hover:bg-neo-maroon/10 hover:pl-4 transition-all duration-100"
                      >
                        <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className="ml-1 px-3 lg:px-4 py-2 font-heading font-bold text-xs lg:text-sm uppercase tracking-wide border-[2px] border-neo-navy bg-neo-orange text-neo-navy hover:translate-x-[1px] hover:translate-y-[1px] transition-all duration-150"
              >
                <span className="flex items-center gap-1.5">
                  <User className="w-4 h-4" />
                  Login
                </span>
              </Link>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center gap-2">
            {loggedIn && (
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="p-1.5 border-[2px] border-neo-navy bg-neo-orange"
              >
                <span className="text-[10px] font-black text-neo-navy">{userInitials}</span>
              </button>
            )}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="neo-btn p-2"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile User Dropdown */}
        {userMenuOpen && loggedIn && (
          <div className="md:hidden border-t-[2px] border-neo-navy/20 py-2 space-y-1" ref={mobileUserMenuRef}>
            <div className="px-3 py-2 bg-neo-navy/5 border-[2px] border-neo-navy/10 mb-1">
              <p className="font-heading font-bold text-xs text-neo-navy">{user?.full_name || 'User'}</p>
              <p className="text-[10px] text-neo-navy/50 font-mono">{user?.email || ''}</p>
            </div>
            {userMenuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.path}
                  onClick={() => handleDropdownNavigate(item.path)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-xs font-bold uppercase border-[2px] border-neo-navy/20 text-neo-navy hover:bg-neo-orange/15"
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-xs font-bold uppercase border-[2px] border-neo-maroon/30 text-neo-maroon hover:bg-neo-maroon/10"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
          </div>
        )}

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t-[3px] border-neo-navy py-4 space-y-2">
            {navLinks.map((link) => {
              const isActive = location.pathname === link.path;
              const Icon = link.icon;

              return (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`
                    block w-full px-4 py-3 font-heading font-bold text-sm uppercase tracking-wide
                    border-[3px] border-neo-navy transition-all duration-150
                    ${isActive
                      ? 'bg-neo-navy text-neo-cream shadow-none'
                      : 'bg-neo-cream text-neo-navy shadow-neo hover:bg-neo-orange'
                    }
                  `}
                >
                  <span className="flex items-center gap-2">
                    {Icon && <Icon className="w-4 h-4" />}
                    {link.label}
                  </span>
                </Link>
              );
            })}

            {!loggedIn && (
              <Link
                to="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="block w-full px-4 py-3 font-heading font-bold text-sm uppercase tracking-wide border-[3px] border-neo-navy bg-neo-orange text-neo-navy shadow-neo"
              >
                <span className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Login
                </span>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-neo-navy/40 backdrop-blur-sm"
            onClick={cancelLogout}
          />
          {/* Modal */}
          <div className="relative bg-neo-cream border-[3px] border-neo-navy shadow-neo p-6 w-[90%] max-w-sm">
            <div className="flex flex-col items-center text-center">
              <div className="w-14 h-14 bg-neo-maroon/10 border-[3px] border-neo-maroon flex items-center justify-center mb-4">
                <AlertTriangle className="w-7 h-7 text-neo-maroon" />
              </div>
              <h3 className="font-heading font-bold text-lg text-neo-navy uppercase tracking-wide mb-1">
                Confirm Logout
              </h3>
              <p className="text-sm text-neo-navy/60 mb-6">
                Are you sure you want to log out of your account?
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={cancelLogout}
                  className="flex-1 px-4 py-2.5 font-heading font-bold text-xs uppercase tracking-wide border-[3px] border-neo-navy bg-neo-cream text-neo-navy hover:bg-neo-navy/5 transition-all duration-150"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmLogout}
                  className="flex-1 px-4 py-2.5 font-heading font-bold text-xs uppercase tracking-wide border-[3px] border-neo-maroon bg-neo-maroon text-neo-cream hover:bg-neo-maroon/90 transition-all duration-150"
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <LogOut className="w-3.5 h-3.5" />
                    Logout
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

