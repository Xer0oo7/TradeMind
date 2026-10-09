import { useState, useEffect } from 'react';
import { Mail, Save, Send, Eye, EyeOff, CheckCircle, XCircle, Bell, BellOff, Shield, Loader2, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { getEmailSettings, updateEmailSettings, sendTestEmail } from '../lib/api';

export default function EmailSettings() {
  const [settings, setSettings] = useState({
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    from_email: '',
    from_name: 'Peitho',
    use_tls: true,
    notifications_enabled: true,
    notify_on_deal: true,
    notify_on_new_session: true,
    notify_on_api_key: true,
  });
  const [configured, setConfigured] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success'|'error', text }

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const data = await getEmailSettings();
      setConfigured(data.configured);
      setSettings({
        smtp_host: data.smtp_host || 'smtp.gmail.com',
        smtp_port: data.smtp_port || 587,
        smtp_user: data.smtp_user || '',
        smtp_password: data.smtp_password || '',
        from_email: data.from_email || '',
        from_name: data.from_name || 'Peitho',
        use_tls: data.use_tls ?? true,
        notifications_enabled: data.notifications_enabled ?? true,
        notify_on_deal: data.notify_on_deal ?? true,
        notify_on_new_session: data.notify_on_new_session ?? true,
        notify_on_api_key: data.notify_on_api_key ?? true,
      });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load email settings' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await updateEmailSettings(settings);
      setConfigured(true);
      setMessage({ type: 'success', text: 'Email settings saved successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    try {
      const data = await sendTestEmail();
      setMessage({ type: 'success', text: `Test email sent to ${data.to}` });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setTesting(false);
    }
  }

  function updateField(field, value) {
    setSettings(prev => ({ ...prev, [field]: value }));
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-[60vh] bg-neo-cream flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-neo-teal" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-[60vh] bg-neo-cream">
        {/* Header */}
        <div className="bg-neo-navy border-b-[3px] border-neo-navy">
          <div className="container mx-auto px-4 py-6">
            <div className="flex items-center gap-3">
              <Link to="/" className="text-neo-cream/60 hover:text-neo-cream transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <Mail className="w-6 h-6 text-neo-orange" />
              <h1 className="font-heading text-2xl font-bold text-neo-cream">
                Email <span className="text-neo-orange">Notifications</span>
              </h1>
              {configured && (
                <span className="ml-auto flex items-center gap-1 text-sm text-green-400 font-medium">
                  <CheckCircle className="w-4 h-4" /> Configured
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-8 max-w-4xl">
          {/* Status Message */}
          {message && (
            <div className={`mb-6 p-4 border-[3px] border-neo-navy font-medium flex items-center gap-2 ${
              message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>
              {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
              {message.text}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {/* SMTP Configuration — Main Column */}
            <form onSubmit={handleSave} className="lg:col-span-2 space-y-6">
              {/* SMTP Settings Card */}
              <div className="bg-white border-[3px] border-neo-navy shadow-neo">
                <div className="border-b-[3px] border-neo-navy px-6 py-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-neo-teal" />
                  <h2 className="font-heading font-bold text-lg">SMTP Configuration</h2>
                </div>
                <div className="p-6 space-y-4">
                  {/* Gmail hint */}
                  <div className="bg-neo-cream/50 border-2 border-neo-navy/20 p-4 text-sm text-neo-navy/70">
                    <strong>Gmail Users:</strong> Use <code className="bg-white px-1 py-0.5 border border-neo-navy/20">smtp.gmail.com</code> with port <code className="bg-white px-1 py-0.5 border border-neo-navy/20">587</code>. 
                    You'll need an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-neo-teal font-medium underline">App Password</a> (not your regular password).
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-neo-navy mb-1">SMTP Host</label>
                      <input
                        type="text"
                        value={settings.smtp_host}
                        onChange={e => updateField('smtp_host', e.target.value)}
                        className="w-full border-[3px] border-neo-navy px-3 py-2 font-mono text-sm focus:outline-none focus:border-neo-teal"
                        placeholder="smtp.gmail.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-neo-navy mb-1">SMTP Port</label>
                      <input
                        type="number"
                        value={settings.smtp_port}
                        onChange={e => updateField('smtp_port', parseInt(e.target.value) || 587)}
                        className="w-full border-[3px] border-neo-navy px-3 py-2 font-mono text-sm focus:outline-none focus:border-neo-teal"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-neo-navy mb-1">SMTP Username (Email)</label>
                    <input
                      type="email"
                      value={settings.smtp_user}
                      onChange={e => updateField('smtp_user', e.target.value)}
                      className="w-full border-[3px] border-neo-navy px-3 py-2 text-sm focus:outline-none focus:border-neo-teal"
                      placeholder="your@gmail.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-neo-navy mb-1">SMTP Password / App Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={settings.smtp_password}
                        onChange={e => updateField('smtp_password', e.target.value)}
                        className="w-full border-[3px] border-neo-navy px-3 py-2 pr-10 text-sm focus:outline-none focus:border-neo-teal"
                        placeholder="••••••••••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neo-navy/50 hover:text-neo-navy"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-neo-navy mb-1">From Email</label>
                      <input
                        type="email"
                        value={settings.from_email}
                        onChange={e => updateField('from_email', e.target.value)}
                        className="w-full border-[3px] border-neo-navy px-3 py-2 text-sm focus:outline-none focus:border-neo-teal"
                        placeholder="your@gmail.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-neo-navy mb-1">From Name</label>
                      <input
                        type="text"
                        value={settings.from_name}
                        onChange={e => updateField('from_name', e.target.value)}
                        className="w-full border-[3px] border-neo-navy px-3 py-2 text-sm focus:outline-none focus:border-neo-teal"
                        placeholder="Peitho"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer mt-2">
                    <input
                      type="checkbox"
                      checked={settings.use_tls}
                      onChange={e => updateField('use_tls', e.target.checked)}
                      className="w-4 h-4 accent-neo-teal"
                    />
                    <span className="text-sm font-medium text-neo-navy">Use TLS (recommended)</span>
                  </label>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 bg-neo-teal text-white px-6 py-3 border-[3px] border-neo-navy font-heading font-bold shadow-neo hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing || !configured}
                  className="flex items-center gap-2 bg-neo-orange text-white px-6 py-3 border-[3px] border-neo-navy font-heading font-bold shadow-neo hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {testing ? 'Sending...' : 'Send Test Email'}
                </button>
              </div>
            </form>

            {/* Notification Preferences — Sidebar */}
            <div className="space-y-6">
              {/* Master Toggle */}
              <div className="bg-white border-[3px] border-neo-navy shadow-neo">
                <div className="border-b-[3px] border-neo-navy px-6 py-4 flex items-center gap-2">
                  {settings.notifications_enabled ? (
                    <Bell className="w-5 h-5 text-neo-orange" />
                  ) : (
                    <BellOff className="w-5 h-5 text-neo-navy/40" />
                  )}
                  <h2 className="font-heading font-bold text-lg">Notifications</h2>
                </div>
                <div className="p-6 space-y-4">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm font-bold text-neo-navy">Enable All Notifications</span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={settings.notifications_enabled}
                        onChange={e => updateField('notifications_enabled', e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-neo-navy/20 border-2 border-neo-navy peer-checked:bg-neo-teal rounded-none transition-colors"></div>
                      <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white border-2 border-neo-navy peer-checked:translate-x-5 transition-transform"></div>
                    </div>
                  </label>

                  <hr className="border-neo-navy/20" />

                  {/* Individual toggles */}
                  {[
                    { key: 'notify_on_deal', label: 'Deal Outcomes', desc: 'Accepted / rejected deals' },
                    { key: 'notify_on_new_session', label: 'New Sessions', desc: 'When a negotiation starts' },
                    { key: 'notify_on_api_key', label: 'API Key Events', desc: 'Key created or revoked' },
                  ].map(item => (
                    <label key={item.key} className={`flex items-start gap-3 cursor-pointer ${!settings.notifications_enabled ? 'opacity-40 pointer-events-none' : ''}`}>
                      <input
                        type="checkbox"
                        checked={settings[item.key]}
                        onChange={e => updateField(item.key, e.target.checked)}
                        className="w-4 h-4 accent-neo-teal mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-bold text-neo-navy block">{item.label}</span>
                        <span className="text-xs text-neo-navy/60">{item.desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Setup Guide */}
              <div className="bg-white border-[3px] border-neo-navy shadow-neo">
                <div className="border-b-[3px] border-neo-navy px-6 py-4">
                  <h2 className="font-heading font-bold text-lg">Gmail Setup Guide</h2>
                </div>
                <div className="p-6">
                  <ol className="space-y-3 text-sm text-neo-navy/80">
                    <li className="flex gap-2">
                      <span className="font-bold text-neo-teal min-w-[20px]">1.</span>
                      <span>Go to <a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer" className="text-neo-teal underline">Google Account Security</a></span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-neo-teal min-w-[20px]">2.</span>
                      <span>Enable 2-Step Verification</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-neo-teal min-w-[20px]">3.</span>
                      <span>Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-neo-teal underline">App Passwords</a></span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-neo-teal min-w-[20px]">4.</span>
                      <span>Create app password for "Mail"</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-neo-teal min-w-[20px]">5.</span>
                      <span>Paste the 16-char password above</span>
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
