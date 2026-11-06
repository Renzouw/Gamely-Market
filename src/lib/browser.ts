import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

/**
 * Opens a web page inside the app: a Chrome Custom Tab on Android (Safari on
 * iOS) that slides over Gamely, with a close button back to it. It runs on
 * Chrome, so sign-ins and saved cards there carry over, and payments work as
 * they do in the browser. If that can't open, the page goes to the browser.
 */
export async function openInApp(url: string, toolbarColor?: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor,
      showTitle: true,
      enableBarCollapsing: true,
      // Part of Gamely's own task, so Back and the close button both come straight back here
      createTask: false,
    });
  } catch {
    await Linking.openURL(url).catch(() => undefined);
  }
}
