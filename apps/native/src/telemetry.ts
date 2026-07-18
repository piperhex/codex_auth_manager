import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const INSTALLATION_KEY = 'codex-switch.mobile.installation.v1';

interface InstallationState {
  deviceId: string;
  reportedVersions: Record<string, string>;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

async function loadOrCreateInstallation(): Promise<InstallationState> {
  try {
    const raw = await SecureStore.getItemAsync(INSTALLATION_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<InstallationState>;
      if (typeof value.deviceId === 'string') {
        return {
          deviceId: value.deviceId,
          reportedVersions: value.reportedVersions ?? {},
        };
      }
    }
  } catch {
    // A damaged local telemetry value is replaced with a fresh anonymous ID.
  }

  const installation: InstallationState = {
    deviceId: Crypto.randomUUID(),
    reportedVersions: {},
  };
  await SecureStore.setItemAsync(INSTALLATION_KEY, JSON.stringify(installation));
  return installation;
}

export async function reportMobileInstallation(baseUrlInput: string): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;

  const baseUrl = normalizeBaseUrl(baseUrlInput);
  const appVersion = Application.nativeApplicationVersion ?? 'unknown';
  const installation = await loadOrCreateInstallation();
  if (installation.reportedVersions[baseUrl] === appVersion) return false;

  const response = await fetch(`${baseUrl}/telemetry/installations`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      deviceId: installation.deviceId,
      platform: Platform.OS,
      appVersion,
      eventType: 'installation',
    }),
  });
  if (!response.ok) throw new Error(`Installation telemetry failed with HTTP ${response.status}`);

  installation.reportedVersions[baseUrl] = appVersion;
  await SecureStore.setItemAsync(INSTALLATION_KEY, JSON.stringify(installation));
  return true;
}
