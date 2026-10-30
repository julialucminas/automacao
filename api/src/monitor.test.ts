import { describe, expect, it } from 'vitest';
import { abrirBanco, repositorio } from './db.js';
import { interpretar, monitorCaixa } from './monitor.js';

const ID = '<3f2b9c1e-8a4d-4c2b-9f1e-0a1b2c3d4e5f@lucminas.com.br>';

// devolução padrão (RFC 3464), como a do Gmail / Postfix
const DSN = `Return-Path: <>
From: Mail Delivery System <MAILER-DAEMON@smtps.uhserver.com>
To: financeiro@lucminas.com.br
Subject: Undelivered Mail Returned to Sender
Date: Fri, 30 Oct 2026 14:20:00 -0300
Message-ID: <20261030172000.ABC@smtps.uhserver.com>
Content-Type: multipart/report; report-type=delivery-status;
 boundary="B1"

--B1
Content-Type: text/plain

I'm sorry to have to inform you that your message could not
be delivered to one or more recipients.

--B1
Content-Type: message/delivery-status

Reporting-MTA: dns; smtps.uhserver.com

Final-Recipient: rfc822; compras@fenixsa.com.br
Original-Recipient: rfc822;compras@fenixsa.com.br
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 <compras@fenixsa.com.br>: Recipient address
 rejected: User unknown in virtual mailbox table

--B1
Content-Type: text/rfc822-headers

From: Financeiro <financeiro@lucminas.com.br>
Subject: Fatura 1234
Message-ID: ${ID}
X-Lucminas-Fatura: 1234

--B1--
`;

// confirmação de leitura (RFC 8098), como a do Outlook / Thunderbird
const MDN = `From: Compras Fenix <compras@fenixsa.com.br>
To: financeiro@lucminas.com.br
Subject: Lido: Fatura de locação nº 1234
Date: Fri, 30 Oct 2026 15:02:00 -0300
Content-Type: multipart/report; report-type=disposition-notification; boundary="M"

--M
Content-Type: text/plain; charset=utf-8

Sua mensagem foi lida em 30/10/2026 15:02.

--M
Content-Type: message/disposition-notification

Reporting-UA: Microsoft Outlook
Final-Recipient: rfc822;compras@fenixsa.com.br
Original-Message-ID: ${ID}
Disposition: manual-action/MDN-sent-manually; displayed

--M--
`;

describe('interpretar mensagens da caixa de entrada', () => {
  it('devolução padrão', () => {
    expect(interpretar(DSN)).toEqual({
      tipo: 'devolvido',
      messageIds: [ID.toLowerCase()],
      quando: '2026-10-30T17:20:00.000Z',
      enderecos: ['compras@fenixsa.com.br'],
      motivo: expect.stringMatching(/^E-mail não existe \(550 5\.1\.1/),
    });
  });

  it('confirmação de leitura', () => {
    expect(interpretar(MDN)).toEqual({ tipo: 'lido', messageIds: [ID.toLowerCase()], quando: '2026-10-30T18:02:00.000Z', quem: 'compras@fenixsa.com.br' });
  });

  it('recusa de confirmação ("deleted") e atraso não contam', () => {
    expect(interpretar(MDN.replace('displayed', 'deleted'))).toBeNull();
    expect(interpretar(DSN.replace('Action: failed', 'Action: delayed'))).toBeNull();
  });

  it('devolução em texto simples (sem relatório), com o cabeçalho original citado', () => {
    const t = `From: postmaster@empresa.com.br
Subject: Mensagem não entregue: Fatura 1234
Date: Fri, 30 Oct 2026 14:30:00 -0300

A mensagem não pôde ser entregue a: <fiscal@empresa.com.br>:
Mailbox is full / caixa postal cheia

----- Mensagem original -----
Message-ID: ${ID}
`;
    expect(interpretar(t)).toMatchObject({ tipo: 'devolvido', messageIds: [ID.toLowerCase()], enderecos: ['fiscal@empresa.com.br'], motivo: expect.stringMatching(/^Caixa do cliente cheia/) });
  });

  it('e-mail normal de cliente é ignorado', () => {
    expect(interpretar(`From: joao@cliente.com\nSubject: Re: Fatura 1234\n\nRecebido, obrigado!\n> Message-ID: ${ID}\n`)).toBeNull();
  });
});

describe('aplicar no histórico', () => {
  it('marca lido e devolvido no envio certo, sem duplicar, e acha devolução sem ID pelo endereço', () => {
    const db = abrirBanco(':memory:');
    const repo = repositorio(db);
    const ins = db.prepare(
      `INSERT INTO envios (id, enviado_em, referencia, numero, cliente_id, cliente_nome, para, cc, assunto, anexos, message_id, copia_em_enviados, pediu_leitura, status, detalhe)
       VALUES (?, ?, '2026-10', ?, NULL, 'FENIX', ?, '[]', 'x', '[]', ?, 1, 1, 'enviado', '')`,
    );
    ins.run('e1', '2026-10-30T17:00:00.000Z', '1234', JSON.stringify(['compras@fenixsa.com.br']), ID);
    ins.run('e2', '2026-10-30T17:05:00.000Z', '1240', JSON.stringify(['fiscal@empresa.com.br']), '<outro@lucminas.com.br>');
    const m = monitorCaixa(db, repo, () => null);

    expect(m.aplicar(interpretar(MDN)!)).toBe(1);
    expect(m.aplicar(interpretar(MDN)!)).toBe(0);
    let e1 = repo.listarEnvios().find((e) => e.id === 'e1')!;
    expect(e1).toMatchObject({ status: 'lido', lidoEm: '2026-10-30T18:02:00.000Z', lidoPor: 'compras@fenixsa.com.br' });

    // uma devolução depois de lido não apaga o "lido" (alguém recebeu), mas fica guardada
    m.aplicar(interpretar(DSN)!);
    e1 = repo.listarEnvios().find((e) => e.id === 'e1')!;
    expect(e1.status).toBe('lido');
    expect(e1.devolucao).toMatch(/Voltou de compras@fenixsa\.com\.br/);

    // devolução sem o ID: acha pelo endereço
    const semId = interpretar(`From: MAILER-DAEMON@x.com\nSubject: Undeliverable: Fatura\nDate: Fri, 30 Oct 2026 14:30:00 -0300\n\n<fiscal@empresa.com.br>: user unknown\n`)!;
    expect(m.aplicar(semId)).toBe(1);
    expect(repo.listarEnvios().find((e) => e.id === 'e2')).toMatchObject({ status: 'devolvido', devolucao: expect.stringMatching(/E-mail não existe/) });
  });
});
