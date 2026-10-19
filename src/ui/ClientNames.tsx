import { createContext, useContext, type ReactNode } from 'react';

// Names of the clients behind each operation code, from the database (stage 6a of the redesign):
// screens no longer write "Hovership" or "T-Force" themselves.
const ClientNamesContext = createContext<Record<string, string>>({});

export function ClientNamesProvider({ names, children }: { names: Record<string, string>; children: ReactNode }) {
  return <ClientNamesContext.Provider value={names}>{children}</ClientNamesContext.Provider>;
}

/** `(operationCode) => client name`; falls back to the code itself. */
export function useClientName() {
  const names = useContext(ClientNamesContext);
  return (operation: string) => names[operation] ?? operation;
}
