import { getAddress, isAddress, stringToHex, type Address } from 'viem';
import { base } from 'viem/chains';
import type { EthereumProvider } from './adapters/evm';

export type TreasuryWallet = 'coinbase_wallet' | 'metamask';
type Provider = Pick<EthereumProvider, 'request'>;

interface InjectedProvider extends Provider {
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isCoinbaseBrowser?: boolean;
  isBaseAccount?: boolean;
  providers?: InjectedProvider[];
}

interface AnnouncedProvider {
  info: { rdns: string };
  provider: InjectedProvider;
}

export interface TreasuryStatus {
  configured: boolean;
  walletVerified: boolean;
  verifiedAt?: string | null;
  x402Enabled: boolean;
  x402FacilitatorAuthentication?: 'wallet' | 'merchant_configured';
  x402FacilitatorCredentialSource?: 'vercel' | 'supabase';
}

interface TreasuryChallenge {
  challenge: string;
  targetAddress: Address;
}

export const BASE_CHAIN_ID = base.id;
const BASE_CHAIN_HEX = `0x${base.id.toString(16)}`;

export function findInjectedWallet(wallet: TreasuryWallet, announced: AnnouncedProvider[]): Provider | undefined {
  const domains = wallet === 'metamask' ? ['io.metamask'] : ['com.coinbase.wallet', 'app.base'];
  const match = announced.find(({ info }) => domains.includes(info.rdns));
  if (match) return match.provider;

  const injected = window.ethereum as InjectedProvider | undefined;
  return (injected?.providers ?? (injected ? [injected] : [])).find((provider) => {
    const isCoinbase = provider.isCoinbaseWallet || provider.isBaseAccount || provider.isCoinbaseBrowser;
    return wallet === 'coinbase_wallet' ? isCoinbase : provider.isMetaMask && !isCoinbase;
  });
}

export function discoverInjectedWallets(onUpdate: (providers: AnnouncedProvider[]) => void) {
  const providers: AnnouncedProvider[] = [];
  const onAnnouncement = (event: Event) => {
    const announced = (event as CustomEvent<AnnouncedProvider>).detail;
    if (!announced?.info || typeof announced.provider?.request !== 'function') return;
    if (providers.some(({ provider }) => provider === announced.provider)) return;
    providers.push(announced);
    onUpdate([...providers]);
  };
  window.addEventListener('eip6963:announceProvider', onAnnouncement);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  return () => window.removeEventListener('eip6963:announceProvider', onAnnouncement);
}

export async function readTreasuryApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error?.message ?? 'A verificação GXEON está indisponível. Tente novamente.');
  }
  return data as T;
}

export function isWalletError(error: unknown, code: number) {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

export async function prepareTreasuryVerification(provider: Provider) {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const selected = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof selected !== 'string' || !isAddress(selected)) {
    throw new Error('Selecione uma conta na carteira e tente novamente.');
  }
  const address = getAddress(selected);
  const path = `/v1/treasury/challenge?${new URLSearchParams({ address })}`;
  const { challenge, targetAddress } = await readTreasuryApi<TreasuryChallenge>(path);
  if (typeof challenge !== 'string' || targetAddress?.toLowerCase() !== address.toLowerCase()) {
    throw new Error('O GXEON não confirmou a conta selecionada.');
  }

  if (Number(await provider.request({ method: 'eth_chainId' })) !== BASE_CHAIN_ID) {
    const switchChain = { method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_HEX }] };
    try {
      await provider.request(switchChain);
    } catch (error) {
      if (!isWalletError(error, 4902)) throw error;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: BASE_CHAIN_HEX,
          chainName: base.name,
          nativeCurrency: base.nativeCurrency,
          rpcUrls: base.rpcUrls.default.http,
          blockExplorerUrls: [base.blockExplorers.default.url],
        }],
      });
      if (Number(await provider.request({ method: 'eth_chainId' })) !== BASE_CHAIN_ID) {
        await provider.request(switchChain);
      }
    }
    if (Number(await provider.request({ method: 'eth_chainId' })) !== BASE_CHAIN_ID) {
      throw new Error('Selecione a rede Base na sua carteira e tente novamente.');
    }
  }

  return { provider, address, challenge };
}

export type PreparedTreasuryVerification = Awaited<ReturnType<typeof prepareTreasuryVerification>>;

export async function confirmTreasuryVerification(
  { provider, address, challenge }: PreparedTreasuryVerification,
  walletProvider: TreasuryWallet,
) {
  const signature = await provider.request({ method: 'personal_sign', params: [stringToHex(challenge), address] });
  if (typeof signature !== 'string') throw new Error('A carteira não retornou uma assinatura.');

  const proof = await readTreasuryApi<{ verified: boolean; verifiedAt?: string; recoveredAddress?: Address }>(
    '/v1/treasury/verify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, challenge, signature, walletProvider }),
    },
  );
  if (!proof.verified || proof.recoveredAddress?.toLowerCase() !== address.toLowerCase()) {
    throw new Error('O GXEON não conseguiu confirmar a assinatura.');
  }
  return { address, verifiedAt: proof.verifiedAt };
}
