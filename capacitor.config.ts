/**
 * Capacitor Native iOS Configuration for Xcode (iPhone 17 / Dynamic Island)
 * -------------------------------------------------------------------------
 * Run on your Mac to build and open in Xcode:
 *   1. npm install @capacitor/core @capacitor/cli @capacitor/ios
 *   2. npx cap add ios
 *   3. npm run ios:sync
 *   4. npm run ios:open
 */
const config = {
  appId: 'com.moviejournal.cinema',
  appName: 'MovieJournal',
  webDir: 'dist',
  backgroundColor: '#000000',
  ios: {
    contentInset: 'never',
    backgroundColor: '#000000',
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
  server: {
    iosScheme: 'capacitor',
    cleartext: true,
    allowNavigation: [
      'image.tmdb.org',
      '*.tmdb.org',
      '*.youtube.com',
      '*.ytimg.com',
      '*.firebaseio.com',
      '*.googleapis.com',
      '*.run.app',
    ],
  },
};

export default config;
