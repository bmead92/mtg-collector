import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { colors } from '../components/theme';
import { backupIfDue, scheduleAutoBackup } from '../lib/autoBackup';
import { onCollectionChange } from '../lib/db';
import { cleanupTempPhotos } from '../lib/photos';
import { restoreStack } from '../lib/stack';

export default function RootLayout() {
  useEffect(() => {
    cleanupTempPhotos();
    void restoreStack();
    onCollectionChange(() => scheduleAutoBackup());
    backupIfDue().catch(() => {});
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'My Collection' }} />
        <Stack.Screen name="scan" options={{ headerShown: false }} />
        <Stack.Screen name="confirm" options={{ title: 'Confirm card' }} />
        <Stack.Screen name="stack" options={{ title: 'Stack' }} />
        <Stack.Screen name="card/[id]" options={{ title: '' }} />
        <Stack.Screen name="source/[id]" options={{ title: '' }} />
        <Stack.Screen name="growth" options={{ title: 'Growth' }} />
        <Stack.Screen name="import" options={{ title: 'Import deck' }} />
        <Stack.Screen name="history" options={{ title: 'History' }} />
      </Stack>
    </>
  );
}
