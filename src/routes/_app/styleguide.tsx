import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button, Dialog, Figures, PageHead, Panel, Pill, RoutePlate, Sheet, WarningDiamond, useToast } from '~/ui';

// Component reference for reviewers and screenshots. Not linked from the navigation.
export const Route = createFileRoute('/_app/styleguide')({ component: Styleguide });

function Styleguide() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <PageHead title="Components" lead="Shared pieces from docs/design-system.md." />
      <Panel title="Route plates">
        <div className="panel-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <RoutePlate code="9000A" size="sm" /><RoutePlate code="9000A" /><RoutePlate code="9000A" size="lg" />
          <RoutePlate code="9000Z" needsDriver />
        </div>
      </Panel>
      <Panel title="Status">
        <div className="panel-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill tone="ok">Confirmed</Pill><Pill tone="waiting">Waiting</Pill><Pill tone="warn">Needs you</Pill>
          <Pill tone="contractor">Contractor</Pill><Pill tone="muted">Inactive</Pill><Pill tone="bad">Negative</Pill>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><WarningDiamond />3 exceptions block payroll</span>
        </div>
      </Panel>
      <Panel title="Figures">
        <Figures items={[
          { label: 'Packages', value: '2,553' },
          { label: 'Owed to drivers', value: '$7,344.50' },
          { label: 'Profit', value: '$1,222.50', note: 'STEM counted at operation level' },
        ]} />
      </Panel>
      <Panel title="Buttons">
        <div className="panel-body" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Button variant="primary" onClick={() => toast('Route 9000E changed to Norwin Saloman', () => toast('Change undone'))}>Show a toast</Button>
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
          <Button variant="primary" id="approve-demo" disabledReason="3 open exceptions in the weekly check">Approve $13,389.00</Button>
        </div>
      </Panel>
      <Dialog open={dialog} onClose={() => setDialog(false)} title="Approve payroll"
        footer={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary">Approve $13,389.00</Button></>}>
        <p style={{ margin: 0 }}>Dialog body.</p>
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Extra job"
        footer={<Button variant="primary" size="lg" style={{ width: '100%' }}>Save extra job</Button>}>
        <div className="field"><label htmlFor="amt">Client amount</label><input id="amt" className="input input-ai" inputMode="decimal" /></div>
      </Sheet>
    </>
  );
}
