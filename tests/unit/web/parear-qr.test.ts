import { describe, expect, it, vi } from "vitest";
import { correcaoReedSolomon, matrizQr, svgQr, type MatrizQr } from "../../../web/lib/qr.ts";
import { criarContaNoChat, htmlEtapa, type ApiConta } from "../../../web/telas/conta-no-chat.ts";
import { codigoDoFragmento, htmlQrDoPareamento, urlDoPareamento } from "../../../web/telas/parear-qr.ts";

/**
 * #84: conectar o celular pelo QR. O computador da conta mostra o QR com `<endereço>/#parear=<código>`; o celular abre o
 * link e manda o mesmo código de 6 números do pareamento (ADR-124), sem nada novo no servidor. O gerador de QR também foi
 * conferido fora daqui com um leitor de verdade (OpenCV): 78 textos, versões 1 a 10, as 8 máscaras.
 */

/** Lê os 15 bits do formato (primeira cópia) e devolve [nível, máscara]. */
function formato(m: MatrizQr): [number, number] {
  const b = (x: number, y: number) => (m[y]![x] ? 1 : 0);
  const bits = [...[0, 1, 2, 3, 4, 5].map((i) => b(8, i)), b(8, 7), b(8, 8), b(7, 8), ...[9, 10, 11, 12, 13, 14].map((i) => b(14 - i, 8))];
  const v = bits.reduce((a, bit, i) => a | (bit << i), 0) ^ 0x5412;
  return [(v >>> 13) & 3, (v >>> 10) & 7];
}

describe("o gerador de QR", () => {
  it("a correção Reed-Solomon bate com o exemplo da norma (versão 1-M, '01234567')", () => {
    const dados = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect(correcaoReedSolomon(dados, 10)).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });

  it("usa a menor versão que cabe: o link do nod (36 bytes) é a versão 3, 29×29", () => {
    expect(matrizQr("a")!).toHaveLength(21);
    expect(matrizQr("https://app.nodbot.ai/#parear=123456")!).toHaveLength(29);
    expect(matrizQr("x".repeat(150))!).toHaveLength(49); // versão 8, com os bits da versão
    expect(matrizQr("x".repeat(213))!).toHaveLength(57); // versão 10, o limite
    expect(matrizQr("x".repeat(214))).toBeNull();
  });

  it("tem os três localizadores, a linha de tempo, o módulo escuro fixo e o formato com nível M", () => {
    const m = matrizQr("https://app.nodbot.ai/#parear=123456")!;
    const n = m.length;
    for (const [x0, y0] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
      for (let i = 0; i < 7; i++) {
        expect(m[y0]![x0 + i]).toBe(true);
        expect(m[y0 + 6]![x0 + i]).toBe(true);
        expect(m[y0 + i]![x0]).toBe(true);
        expect(m[y0 + i]![x0 + 6]).toBe(true);
      }
      expect(m[y0 + 1]![x0 + 1]).toBe(false);
      expect(m[y0 + 3]![x0 + 3]).toBe(true);
    }
    for (let i = 8; i < n - 8; i++) { expect(m[6]![i]).toBe(i % 2 === 0); expect(m[i]![6]).toBe(i % 2 === 0); }
    expect(m[n - 8]![8]).toBe(true);
    const [nivel, mascara] = formato(m);
    expect(nivel).toBe(0);
    expect(mascara).toBeGreaterThanOrEqual(0);
    expect(mascara).toBeLessThan(8);
  });

  it("o SVG é preto no branco, com a margem de 4 módulos e o rótulo escapado", () => {
    const s = svgQr("https://app.nodbot.ai/#parear=123456", 'QR "x" & <y>')!;
    expect(s).toContain('viewBox="0 0 37 37"');
    expect(s).toContain('fill="#fff"');
    expect(s).toContain('fill="#000"');
    expect(s).toContain('aria-label="QR &quot;x&quot; &amp; &lt;y>"');
    expect(svgQr("x".repeat(300), "r")).toBeNull();
  });
});

describe("o link do QR", () => {
  it("leva o código no fragmento, que o navegador não manda ao servidor", () => {
    expect(urlDoPareamento("https://app.nodbot.ai", "123456")).toBe("https://app.nodbot.ai/#parear=123456");
    expect(urlDoPareamento("http://nod.exemplo.test:8080", "000001")).toBe("http://nod.exemplo.test:8080/#parear=000001");
  });

  it("sem link onde o celular não alcança (o próprio computador, arquivo local) ou com código fora do formato", () => {
    for (const o of ["http://localhost:3000", "http://127.0.0.1:8080", "http://[::1]:8080", "http://app.localhost", "file:///C:/nod/index.html", "nada", null]) {
      expect(urlDoPareamento(o, "123456")).toBeNull();
    }
    expect(urlDoPareamento("https://app.nodbot.ai", "12345")).toBeNull();
    expect(urlDoPareamento("https://app.nodbot.ai", "12a456")).toBeNull();
    expect(htmlQrDoPareamento("http://localhost:3000", "123456")).toBe("");
    expect(htmlQrDoPareamento("https://app.nodbot.ai", "123456")).toContain('<div class="cc-qr"><svg');
  });

  it("no celular, só os 6 números do fragmento valem como código", () => {
    expect(codigoDoFragmento("#parear=123456")).toBe("123456");
    for (const h of ["#parear=12345", "#parear=1234567", "#parear=12a456", "#parear=123456&x=1", "#redefinir=123456", "", "#"]) expect(codigoDoFragmento(h)).toBeNull();
  });
});

describe("o cartão do pareamento no computador da conta", () => {
  const vista = { ocupado: false, google: true, agora: 1_000 };
  const gerar = { tipo: "parear-gerar" as const, codigo: "123456", expiraEm: 301_000, pedido: null, vencido: false };

  it("com um endereço que o celular alcança: QR, o código e o texto para os dois casos", () => {
    const h = htmlEtapa(gerar, { ...vista, origem: "https://app.nodbot.ai" });
    expect(h).toContain("Conectar celular ou outro computador");
    expect(h).toContain("No celular, aponte a câmera para o QR code");
    expect(h).toContain('<div class="cc-qr"><svg');
    expect(h).toContain("123 456");
    expect(h).toContain("5:00");
    const pronto = htmlEtapa({ tipo: "parear-pronto" }, { ...vista, origem: "https://app.nodbot.ai" });
    expect(pronto).toContain("Conectar celular ou outro computador");
    expect(pronto).toContain("Gerar código");
  });

  it("sem esse endereço (ou sem a informação), o cartão de antes, só com o código", () => {
    for (const origem of [undefined, null, "http://localhost:3000"]) {
      const h = htmlEtapa(gerar, { ...vista, ...(origem === undefined ? {} : { origem }) });
      expect(h).toContain("Conectar outro computador");
      expect(h).not.toContain("cc-qr");
      expect(h).toContain("123 456");
      expect(htmlEtapa({ tipo: "parear-pronto" }, { ...vista, ...(origem === undefined ? {} : { origem }) })).not.toContain("celular");
    }
  });

  it("o bloco da conversa passa o endereço do controlador ao cartão", async () => {
    const api = { gerarPareamento: vi.fn(async () => ({ codigo: "654321", expiraEm: 301_000 })), pareamento: vi.fn(async () => ({ pareamento: null })) };
    const c = criarContaNoChat({
      api: () => api as unknown as ApiConta, conversaDoNod: () => ({ conversaId: "conv-nod", agenteId: "nod" }), conversaDaTela: () => null,
      irParaConversa: () => undefined, aoMudar: () => undefined, google: () => false, noApp: () => false, entrou: async () => undefined,
      contaMudou: () => undefined, abrirUrl: () => undefined, agora: () => 1_000, intervalo: () => () => undefined, campo: () => "",
      origem: () => "https://app.nodbot.ai",
    });
    await c.abrir("parear-gerar");
    expect(c.blocoNaConversa("conv-nod")).toContain('<div class="cc-qr"><svg');
  });
});

describe("o celular que abriu o link", () => {
  it("abre 'Entrar com código' na conversa do Nod, manda o código sozinho e mostra os símbolos para conferir", async () => {
    const pedirPareamento = vi.fn(async () => ({ resultado: "pedido" as const, simbolos: ["sol", "lua", "flor"] }));
    const irParaConversa = vi.fn();
    const ticks: (() => void)[] = [];
    const c = criarContaNoChat({
      api: () => ({ pedirPareamento }) as unknown as ApiConta, conversaDoNod: () => ({ conversaId: "conv-nod", agenteId: "nod" }), conversaDaTela: () => null,
      irParaConversa, aoMudar: () => undefined, google: () => false, noApp: () => false, entrou: async () => undefined,
      contaMudou: () => undefined, abrirUrl: () => undefined, agora: () => 1_000, intervalo: (fn) => { ticks.push(fn); return () => undefined; }, campo: () => "",
    });
    await c.entrarComCodigo("123456");
    expect(irParaConversa).toHaveBeenCalledWith("conv-nod", "nod");
    expect(pedirPareamento).toHaveBeenCalledWith("123456");
    const h = c.blocoNaConversa("conv-nod");
    expect(h).toContain("Confirme no outro computador");
    expect(h).toContain("🌸");
    expect(ticks).toHaveLength(1); // espera a confirmação, como no código digitado
  });

  it("código que não vale (vencido, usado): a mesma mensagem do código digitado, com o campo para tentar de novo", async () => {
    const c = criarContaNoChat({
      api: () => ({ pedirPareamento: async () => ({ resultado: "invalido" as const }) }) as unknown as ApiConta, conversaDoNod: () => ({ conversaId: "conv-nod", agenteId: "nod" }),
      conversaDaTela: () => null, irParaConversa: () => undefined, aoMudar: () => undefined, google: () => false, noApp: () => false, entrou: async () => undefined,
      contaMudou: () => undefined, abrirUrl: () => undefined, agora: () => 1_000, intervalo: () => () => undefined, campo: () => "",
    });
    await c.entrarComCodigo("123456");
    const h = c.blocoNaConversa("conv-nod");
    expect(h).toContain("Esse código não vale");
    expect(h).toContain('data-form="conta-parear-pedir"');
  });
});
