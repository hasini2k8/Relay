import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/state';
import { C } from './src/ui';
import { Restore, Welcome } from './src/screens/Welcome';
import { Home } from './src/screens/Home';
import { Send } from './src/screens/Send';
import { Claim, Receive, Settings } from './src/screens/Other';
import { CashOut } from './src/screens/CashOut';
import { CreatePot, PotView, Propose, ProposalView } from './src/screens/Pots';

function Router() {
  const { ready, route } = useApp();
  if (!ready)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  switch (route.name) {
    case 'welcome':
      return <Welcome />;
    case 'restore':
      return <Restore />;
    case 'home':
      return <Home />;
    case 'send':
      return <Send />;
    case 'receive':
      return <Receive />;
    case 'claim':
      return <Claim key={route.code ?? 'manual'} code={route.code} />;
    case 'settings':
      return <Settings />;
    case 'createPot':
      return <CreatePot />;
    case 'pot':
      return <PotView key={route.id} id={route.id} />;
    case 'propose':
      return <Propose potId={route.potId} />;
    case 'proposal':
      return <ProposalView key={route.xdr.slice(0, 120)} xdr={route.xdr} />;
    case 'anchor':
      return <CashOut key={route.resumeId ?? route.kind} kind={route.kind} resumeId={route.resumeId} />;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <Router />
      </AppProvider>
    </SafeAreaProvider>
  );
}
