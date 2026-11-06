import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { runLocalCheck } from './localAlerts';

export const LOCAL_CHECK_TASK = 'gamely-local-price-check';

// Must be defined when the module loads (imported from the root layout), not inside a component
if (Platform.OS !== 'web') {
  TaskManager.defineTask(LOCAL_CHECK_TASK, async () => {
    try {
      await runLocalCheck();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/**
 * Ask the phone to check watched prices now and then while the app is
 * closed. The phone decides the timing (iOS often waits for overnight
 * charging), so this is a safety net, not a replacement for the server.
 */
export async function setBackgroundChecks(enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(LOCAL_CHECK_TASK);
    if (enabled && !registered && (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available) {
      await BackgroundTask.registerTaskAsync(LOCAL_CHECK_TASK, { minimumInterval: 60 });
    } else if (!enabled && registered) {
      await BackgroundTask.unregisterTaskAsync(LOCAL_CHECK_TASK);
    }
  } catch {
    // Not available in this build (e.g. Expo Go): checks still run when the app opens
  }
}
