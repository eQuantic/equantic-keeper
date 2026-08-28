import { useEffect } from 'react';
import { KeeperProvider, useKeeper } from './state/keeper';
import { ConfigScreen, CreateVaultScreen, SignInScreen, UnlockScreen } from './screens/Onboarding';
import { VaultScreen } from './screens/VaultScreen';
import { Spinner, Toast } from './components/ui';
import { loadTheme, saveTheme } from './lib/storage';

function Shell() {
  const { phase, error, notice, actions, payload } = useKeeper();

  // The vault carries the theme across devices; fall back to the local choice
  // while it is still locked.
  const theme = payload?.preferences.theme ?? loadTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'light' ? '#f4f6fb' : '#0a0d14',
    );
    saveTheme(theme);
  }, [theme]);

  const screen = () => {
    switch (phase) {
      case 'config':
        return <ConfigScreen />;
      case 'signin':
        return <SignInScreen />;
      case 'create':
        return <CreateVaultScreen />;
      case 'locked':
        return <UnlockScreen />;
      case 'unlocked':
        return <VaultScreen />;
      case 'boot':
      default:
        return (
          <div className="flex h-full items-center justify-center text-muted">
            <Spinner size={22} />
          </div>
        );
    }
  };

  return (
    <div className="h-full">
      {screen()}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4">
        {notice ? <Toast message={notice} tone="success" onDismiss={actions.dismissNotice} /> : null}
        {error ? <Toast message={error} tone="error" onDismiss={actions.dismissError} /> : null}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <KeeperProvider>
      <Shell />
    </KeeperProvider>
  );
}
