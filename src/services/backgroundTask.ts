import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { refreshWatchlist } from './alerts';

export const PRICE_CHECK_TASK = 'gamely-price-check';

// Must run at module load (imported from the root layout), not inside a component.
if (Platform.OS !== 'web') {
  TaskManager.defineTask(PRICE_CHECK_TASK, async () => {
    try {
      await refreshWatchlist();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Ask the OS to check watched prices roughly every 6 hours. The OS decides the real timing. */
export async function setBackgroundChecks(enabled: boolean): Promise<void> {
  if (Platform.OS === 'web') return;
  const registered = await TaskManager.isTaskRegisteredAsync(PRICE_CHECK_TASK);
  if (enabled && !registered) {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Available) {
      await BackgroundTask.registerTaskAsync(PRICE_CHECK_TASK, { minimumInterval: 6 * 60 });
    }
  } else if (!enabled && registered) {
    await BackgroundTask.unregisterTaskAsync(PRICE_CHECK_TASK);
  }
}
