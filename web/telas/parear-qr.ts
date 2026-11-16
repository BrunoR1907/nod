import { svgQr } from "../lib/qr.ts";

/**
 * #84: conectar o celular pelo QR. O computador que já está na conta mostra, junto do código de 6 números (ADR-124), um
 * QR com o link `<endereço do nod>/#parear=<código>`. O celular abre o link, o código sai da URL na hora e é enviado
 * sozinho; o computador confirma com os símbolos, como no código digitado. Nada muda no servidor: o QR é só outro jeito
 * de digitar o mesmo código (5 minutos, uso único, confirmação no computador, limite de tentativas).
 *
 * O código vai no fragmento (`#`), que o navegador não manda ao servidor: não entra em log de acesso nem no Referer.
 */

/** A chave da sessionStorage onde o código do link espera a sessão existir (primeira visita: o espaço provisório). */
export const CHAVE_PAREAR_CONTA = "nod-parear-conta";

/** Só os 6 números do pareamento; qualquer outra coisa no fragmento não é um código. */
export function codigoDoFragmento(hash: string): string | null {
  return /^#parear=(\d{6})$/.exec(hash)?.[1] ?? null;
}

/**
 * O link do QR, a partir do endereço onde este nod está aberto. Sem link quando o celular não teria como abrir esse
 * endereço: fora de http(s) (o arquivo local do app) ou no próprio computador (localhost, 127.x, ::1).
 */
export function urlDoPareamento(origem: string | null, codigo: string): string | null {
  if (!origem || !/^\d{6}$/.test(codigo)) return null;
  let u: URL;
  try { u = new URL(origem); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "::1" || host === "0.0.0.0") return null;
  return `${u.origin}/#parear=${codigo}`;
}

/** O QR do link, pronto para o cartão; vazio sem link (o código digitado continua valendo). */
export function htmlQrDoPareamento(origem: string | null, codigo: string): string {
  const url = urlDoPareamento(origem, codigo);
  const svg = url ? svgQr(url, "QR code para conectar o celular") : null;
  return svg ? `<div class="cc-qr">${svg}</div>` : "";
}
