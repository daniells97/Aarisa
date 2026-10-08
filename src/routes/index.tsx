import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: Overview });

function Overview() {
  return <main><h1>Overview</h1></main>;
}
