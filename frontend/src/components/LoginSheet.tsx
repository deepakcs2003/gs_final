import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Sheet } from './ui';
import { api, ApiError } from '../lib/api';
import { useConfig } from '../hooks/queries';
import { useUi, useWishlist } from '../store/ui';

/**
 * Login (README §23, §30).
 *
 * Mobile + OTP is the primary route because it is what customers here already
 * understand. Login is never required to browse — this sheet only appears when
 * someone asks to save something, and afterwards returns them to exactly where
 * they were.
 */

const RESEND_SECONDS = 30;

export function LoginSheet() {
  const open = useUi((state) => state.loginOpen);
  const close = useUi((state) => state.closeLogin);
  const redirect = useUi((state) => state.loginRedirect);
  const toast = useUi((state) => state.toast);
  const wishlistIds = useWishlist((state) => state.ids);

  const { data: config } = useConfig();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const googleSlot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      // Reset so a reopened sheet never shows a stale OTP screen.
      setStep('mobile');
      setCode('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  /** Loads Google Identity Services on demand, only if a client id is set. */
  useEffect(() => {
    if (!open || !config?.googleClientId || !googleSlot.current) return;

    const render = () => {
      const google = (window as unknown as { google?: any }).google;
      if (!google?.accounts?.id || !googleSlot.current) return;

      google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: (response: { credential?: string }) => {
          if (response.credential) void onGoogleCredential(response.credential);
        },
      });
      google.accounts.id.renderButton(googleSlot.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
      });
    };

    if ((window as unknown as { google?: unknown }).google) {
      render();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config?.googleClientId]);

  const finishLogin = async () => {
    await queryClient.invalidateQueries({ queryKey: ['me'] });

    // Fold the guest wishlist into the account (README §26).
    if (wishlistIds.length > 0) {
      await api('/cart/wishlist/merge', { method: 'POST', body: { productIds: wishlistIds } }).catch(() => undefined);
    }

    close();
    toast('Login ho gaya. Welcome! 🌸', 'success');
    if (redirect && redirect !== window.location.pathname) navigate(redirect);
  };

  const onGoogleCredential = async (credential: string) => {
    setBusy(true);
    setError('');
    try {
      await api('/auth/google', { method: 'POST', body: { credential } });
      await finishLogin();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Google login nahi ho paya.');
    } finally {
      setBusy(false);
    }
  };

  const sendOtp = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/auth/otp/send', { method: 'POST', body: { mobile } });
      setStep('otp');
      setSecondsLeft(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'OTP nahi bhej paye. Dobara try karein.');
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/auth/otp/verify', { method: 'POST', body: { mobile, code, ...(name ? { name } : {}) } });
      await finishLogin();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'OTP verify nahi hua.');
    } finally {
      setBusy(false);
    }
  };

  const mobileValid = /^[6-9]\d{9}$/.test(mobile);

  return (
    <Sheet
      open={open}
      onClose={close}
      title={step === 'mobile' ? 'Login karein' : 'OTP daalein'}
      subtitle={
        step === 'mobile'
          ? 'Sirf mobile number se — koi password nahi'
          : `+91 ${mobile} par bheja gaya 6 digit ka code`
      }
    >
      <div className="space-y-4 py-1">
        {step === 'mobile' ? (
          <>
            <div>
              <label className="label" htmlFor="login-mobile">
                Mobile Number
              </label>
              <div className="flex items-center gap-2">
                <span className="grid h-12 shrink-0 place-items-center rounded-xl border border-ink-light/30 bg-maroon-50 px-3 text-[15px] font-semibold text-ink">
                  +91
                </span>
                <input
                  id="login-mobile"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  value={mobile}
                  onChange={(event) => setMobile(event.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10 digit number"
                  className="field"
                />
              </div>
              <p className="hint mt-1.5">Aapka number sirf order aur delivery ke liye use hoga.</p>
            </div>

            <div>
              <label className="label" htmlFor="login-name">
                Aapka naam <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <input
                id="login-name"
                type="text"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="Jaise: Sunita Sharma"
                className="field"
              />
            </div>

            {error ? <p className="text-sm font-medium text-alert">{error}</p> : null}

            <button type="button" onClick={() => void sendOtp()} disabled={!mobileValid || busy} className="btn-primary btn-lg w-full">
              {busy ? 'Bhej rahe hain…' : 'OTP Bhejein'}
            </button>
          </>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="login-otp">
                6 digit OTP
              </label>
              <input
                id="login-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="• • • • • •"
                className="field text-center text-2xl font-bold tracking-[0.5em]"
              />
            </div>

            {error ? <p className="text-sm font-medium text-alert">{error}</p> : null}

            <button
              type="button"
              onClick={() => void verifyOtp()}
              disabled={code.length !== 6 || busy}
              className="btn-primary btn-lg w-full"
            >
              {busy ? 'Check kar rahe hain…' : 'Verify Karein'}
            </button>

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setStep('mobile')} className="text-sm font-semibold text-maroon-700 underline">
                Number badlein
              </button>
              <button
                type="button"
                disabled={secondsLeft > 0 || busy}
                onClick={() => void sendOtp()}
                className="text-sm font-semibold text-maroon-700 underline disabled:text-ink-light disabled:no-underline"
              >
                {secondsLeft > 0 ? `Dobara bhejein (${secondsLeft}s)` : 'OTP dobara bhejein'}
              </button>
            </div>
          </>
        )}

        {config?.googleClientId ? (
          <>
            <div className="flex items-center gap-3 pt-1">
              <span className="h-px flex-1 bg-maroon-100" />
              <span className="text-[13px] text-ink-muted">ya</span>
              <span className="h-px flex-1 bg-maroon-100" />
            </div>
            <div ref={googleSlot} className="flex justify-center" />
          </>
        ) : null}

        <p className="hint pt-1 text-center">
          Login zaroori nahi hai — aap bina login ke bhi order kar sakti hain.
        </p>
      </div>
    </Sheet>
  );
}
