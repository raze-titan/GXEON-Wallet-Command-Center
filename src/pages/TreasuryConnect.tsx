import { createBaseAccountSDK } from '@base-org/account';
import { ArrowLeft, Loader2, ShieldCheck, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  BASE_CHAIN_ID,
  confirmTreasuryVerification,
  discoverInjectedWallets,
  findInjectedWallet,
  isWalletError,
  prepareTreasuryVerification,
  readTreasuryApi,
  type PreparedTreasuryVerification,
  type TreasuryStatus,
  type TreasuryWallet,
} from '../wallets/treasuryConnection';

const baseAccount = createBaseAccountSDK({
  appName: 'GXEON',
  appChainIds: [BASE_CHAIN_ID],
  preference: { telemetry: false },
});

const walletChoices: { id: TreasuryWallet; label: string }[] = [
  { id: 'coinbase_wallet', label: 'Conectar Base / Coinbase' },
  { id: 'metamask', label: 'Conectar MetaMask' },
];

export default function TreasuryConnect() {
  const providers = useRef<Parameters<typeof findInjectedWallet>[1]>([]);
  const [status, setStatus] = useState<TreasuryStatus>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PreparedTreasuryVerification>();
  const [proof, setProof] = useState<Awaited<ReturnType<typeof confirmTreasuryVerification>>>();
  const [error, setError] = useState('');

  useEffect(() => discoverInjectedWallets((available) => { providers.current = available; }), []);
  useEffect(() => {
    const controller = new AbortController();
    void readTreasuryApi<TreasuryStatus>('/v1/treasury/status', { signal: controller.signal })
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted) setError('Não foi possível consultar o estado da carteira.');
      });
    return () => controller.abort();
  }, []);

  async function connect(wallet: TreasuryWallet) {
    setBusy(true);
    setError('');
    try {
      const injected = findInjectedWallet(wallet, providers.current);
      const provider = injected ?? (wallet === 'coinbase_wallet' ? baseAccount.getProvider() : undefined);
      if (!provider) throw new Error('Abra esta página no navegador da MetaMask ou ative a extensão e tente novamente.');

      const verification = await prepareTreasuryVerification(provider);
      if (injected) {
        setProof(await confirmTreasuryVerification(verification, wallet));
      } else {
        // A fresh click lets the hosted Base Account popup open for the signature.
        setPending(verification);
      }
    } catch (cause) {
      setError(walletErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function signWithBase() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      setProof(await confirmTreasuryVerification(pending, 'coinbase_wallet'));
    } catch (cause) {
      setError(walletErrorMessage(cause));
    } finally {
      setPending(undefined);
      setBusy(false);
    }
  }

  const verifiedAt = proof?.verifiedAt ?? status?.verifiedAt;

  return (
    <div className="min-h-screen bg-[#070D18] px-5 py-10 text-slate-100 sm:py-16">
      <main className="mx-auto max-w-lg">
        <a href="/market" className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white">
          <ArrowLeft size={16} aria-hidden="true" /> Voltar ao Marketplace
        </a>
        <section className="mt-7 rounded-3xl border border-[#263B59] bg-[#0D1728] p-6 sm:p-8">
          <div className="mb-5 inline-flex rounded-xl bg-cyan-400/10 p-3 text-cyan-300">
            <Wallet size={24} aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Conectar carteira</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Confirme o endereço de recebimento USDC do GXEON na rede Base. A carteira pede sua aprovação para conectar e assinar a verificação.
          </p>
          <div className="mt-7 grid gap-3" aria-busy={busy}>
            {pending ? (
              <>
                <button type="button" className={buttonClass} disabled={busy} onClick={() => void signWithBase()}>
                  Assinar verificação na Base
                </button>
                <button type="button" className="text-sm text-slate-300 hover:text-white" disabled={busy} onClick={() => setPending(undefined)}>
                  Escolher outra carteira
                </button>
              </>
            ) : !proof && walletChoices.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={id === 'coinbase_wallet' ? buttonClass : secondaryButtonClass}
                disabled={busy || status?.configured === false}
                onClick={() => void connect(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {busy && <p className="mt-4 flex items-center gap-2 text-sm text-slate-300" role="status"><Loader2 className="animate-spin" size={16} /> Aguardando confirmação da carteira…</p>}
          {error && <p className="mt-4 text-sm text-amber-300" role="alert">{error}</p>}
          {status?.configured === false && <p className="mt-4 text-sm text-amber-300" role="status">A conexão da carteira ainda está indisponível.</p>}
          {(proof || status?.walletVerified) && (
            <div className="mt-5 flex gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-100" role="status">
              <ShieldCheck size={20} className="shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">Carteira verificada na Base</p>
                {proof && <p className="mt-1 break-all font-mono text-xs">{proof.address}</p>}
                {verifiedAt && <p className="mt-1 text-xs">{new Date(verifiedAt).toLocaleString('pt-BR')}</p>}
              </div>
            </div>
          )}
          {status?.configured && <p className="mt-5 text-xs text-slate-400">{status.x402Enabled ? 'Recebimentos x402 ativos' : 'Recebimentos x402 pausados'}</p>}
        </section>
      </main>
    </div>
  );
}

const buttonBase = 'min-h-12 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50';
const buttonClass = `${buttonBase} bg-cyan-300 text-[#070D18] hover:bg-cyan-200`;
const secondaryButtonClass = `${buttonBase} border border-[#3C577B] text-slate-100 hover:border-cyan-300`;

function walletErrorMessage(cause: unknown) {
  if (isWalletError(cause, 4001)) return 'Você cancelou a solicitação na carteira. Pode tentar novamente.';
  return cause instanceof Error ? cause.message : 'Não foi possível conectar a carteira. Tente novamente.';
}
