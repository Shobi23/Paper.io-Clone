# Paper Trail Android APK

The project includes an automated Android build in `.github/workflows/build-android-apk.yml`.
It produces a signed debug APK that can be installed directly on Android 7 or newer.

## Get the APK with GitHub

1. Upload this project to a GitHub repository.
2. Open the repository's **Actions** tab.
3. Select **Build Android APK**.
4. Choose **Run workflow** and wait for the green check mark.
5. Open the completed workflow run.
6. Download **Paper-Trail-Android-APK** from the Artifacts section.
7. Unzip the downloaded file to get `paper-trail.apk`.

## Install on your Android phone

1. Send `paper-trail.apk` to the phone or download it there.
2. Open the APK from the Files app.
3. If Android asks, allow **Install unknown apps** for the browser or Files app.
4. Tap **Install**, then open **Paper Trail** from the home screen.

The APK is self-contained and the game runs offline. The automated artifact is intended
for direct installation and testing. Publishing through Google Play requires a private
release keystore and a release-signed AAB or APK.