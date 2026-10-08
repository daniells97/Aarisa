import { Link, createFileRoute } from '@tanstack/react-router';
import { useT } from '~/i18n';
import { todayLA } from '~/domain/dates';
import { getClaim } from '~/server/settlements-fns';
import { Button, useFormat } from '~/ui';
import { clientName, coversText } from '~/ui/settlement-text';

// Printable claim (spec §5.6 "exportable as PDF"): the browser's print dialog saves it as a PDF.
export const Route = createFileRoute('/_app/settlements/claim/$lineId')({
  loader: ({ params }) => getClaim({ data: { lineId: params.lineId } }),
  component: ClaimDocument,
});

function ClaimDocument() {
  const t = useT();
  const f = useFormat();
  const { line, agreement } = Route.useLoaderData();
  const client = clientName(line.operation);
  const j = line.job;
  return (
    <article className="claim-doc">
      <div className="row no-print" style={{ justifyContent: 'space-between' }}>
        <Link to="/settlements" search={{ line: line.id }}>{t('st.back')}</Link>
        <Button variant="primary" onClick={() => window.print()}>{t('st.print')}</Button>
      </div>
      <header>
        <p className="muted" style={{ margin: 0 }}>Aarisa</p>
        <h1>{t('st.claimDocTitle')}</h1>
        <p style={{ margin: 0 }}>{t('st.claimDocFrom', { client, date: f.date(todayLA(), { month: 'long', day: 'numeric', year: 'numeric' }) })}</p>
      </header>
      <table>
        <tbody>
          <tr><th scope="row">{t('st.covers')}</th><td>{coversText(line, t, f)}</td></tr>
          {j && <>
            <tr><th scope="row">{t('st.c.order')}</th><td>{j.orderNumber ?? '–'}</td></tr>
            <tr><th scope="row">{t('st.c.date')}</th><td>{f.date(j.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</td></tr>
            <tr><th scope="row">{t('st.c.near')}</th><td>{j.nearRoute ?? '–'}</td></tr>
            <tr><th scope="row">{t('st.c.doneBy')}</th><td>{j.payee}</td></tr>
            <tr><th scope="row">{t('st.c.agreed', { client })}</th><td className="num">{f.money(j.clientAmountCents)}</td></tr>
            <tr><th scope="row">{t('st.c.paidTo', { payee: j.payee })}</th><td className="num">{f.money(j.payeeAmountCents)}</td></tr>
          </>}
          <tr><th scope="row">{t('st.expected')}</th><td className="num">{f.money(line.expectedCents)}</td></tr>
          <tr><th scope="row">{t('st.receivedCol')}</th><td className="num">{f.money(line.receivedCents)}</td></tr>
          <tr><th scope="row">{t('st.missing')}</th><td className="num"><strong>{f.money(line.missingCents)}</strong></td></tr>
        </tbody>
      </table>
      {agreement?.text && (
        <section>
          <h2>{t('st.c.agreement')}</h2>
          <p className="muted" style={{ margin: 0 }}>{f.dateTime(agreement.at)}</p>
          <blockquote className="agreement">“{agreement.text}”</blockquote>
        </section>
      )}
    </article>
  );
}
