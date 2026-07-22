import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ToastTone = 'success' | 'error';

interface ToastNotice {
  id: number;
  message: string;
  tone: ToastTone;
}

type ToastListener = (notice: ToastNotice) => void;

const listeners = new Set<ToastListener>();
let nextNoticeId = 0;

function show(message: string, tone: ToastTone) {
  const notice = { id: ++nextNoticeId, message, tone };
  listeners.forEach((listener) => listener(notice));
}

export const Toast = {
  success(message: string) {
    show(message, 'success');
  },
  fail(message: string) {
    show(message, 'error');
  },
};

export function AppToastHost() {
  const [notice, setNotice] = useState<ToastNotice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const listener: ToastListener = (nextNotice) => {
      if (timer.current) clearTimeout(timer.current);
      setNotice(nextNotice);
      timer.current = setTimeout(() => {
        setNotice((current) => current?.id === nextNotice.id ? null : current);
        timer.current = null;
      }, 2200);
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!notice) return null;

  return <SafeAreaView pointerEvents="none" edges={['top']} style={styles.host}>
    <View style={[styles.notice, notice.tone === 'error' && styles.noticeError]}>
      <Text style={styles.icon}>{notice.tone === 'success' ? '✓' : '!'}</Text>
      <Text style={styles.message}>{notice.message}</Text>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  notice: {
    maxWidth: 420,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 13,
    backgroundColor: '#126e58',
    shadowColor: '#071b14',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  noticeError: { backgroundColor: '#b74740' },
  icon: { color: '#ffffff', fontSize: 16, lineHeight: 19, fontWeight: '900' },
  message: { flexShrink: 1, color: '#ffffff', fontSize: 14, lineHeight: 20, fontWeight: '700' },
});
