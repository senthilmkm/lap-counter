import React from 'react';
import { Alert } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import App from '../App';
import * as expoSensorsRaw from 'expo-sensors';
import * as ble from 'react-native-ble-plx';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Location from 'expo-location';
import { __resetForTests as __resetBleScanner } from '../src/sensors/bleScanner';

const { __resetAllSensors } = expoSensorsRaw as unknown as {
  __resetAllSensors: () => void;
};
const HapticsMock = Haptics as unknown as { __resetHaptics: () => void };
const NotificationsMock = Notifications as unknown as {
  __resetNotifications: () => void;
};
const BackgroundFetchMock = BackgroundFetch as unknown as {
  __resetBackgroundFetch: () => void;
};
const LocationMock = Location as unknown as {
  __resetLocation: () => void;
  __getActiveWatchers: () => number;
};

const blePlx = ble as unknown as typeof ble & {
  __getLastManager: () => unknown;
  __resetManagers: () => void;
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['performance', 'queueMicrotask'] });
  __resetAllSensors();
  blePlx.__resetManagers();
  __resetBleScanner();
  HapticsMock.__resetHaptics();
  NotificationsMock.__resetNotifications();
  BackgroundFetchMock.__resetBackgroundFetch();
  LocationMock.__resetLocation();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('<App /> — Setup state', () => {
  it('renders the setup card with the default target lap value', () => {
    render(<App />);
    expect(screen.getByText('How many laps do you want?')).toBeTruthy();
    expect(screen.getByText(/▶ Start/)).toBeTruthy();
    const input = screen.getByPlaceholderText('10');
    expect(input.props.value).toBe('10');
  });

  it('shows an alert when the target lap count is invalid', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<App />);
    fireEvent.changeText(screen.getByPlaceholderText('10'), 'abc');
    fireEvent.press(screen.getByText(/▶ Start/));
    expect(alertSpy).toHaveBeenCalledWith(
      'Invalid lap count',
      expect.any(String)
    );
    alertSpy.mockRestore();
  });

  it('shows an alert when the target lap count is zero', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<App />);
    fireEvent.changeText(screen.getByPlaceholderText('10'), '0');
    fireEvent.press(screen.getByText(/▶ Start/));
    expect(alertSpy).toHaveBeenCalledWith(
      'Invalid lap count',
      expect.any(String)
    );
    alertSpy.mockRestore();
  });

  it('transitions to the Running state with a valid target', async () => {
    render(<App />);
    fireEvent.changeText(screen.getByPlaceholderText('10'), '4');
    await act(async () => {
      fireEvent.press(screen.getByText(/▶ Start/));
    });
    await waitFor(() => {
      expect(screen.getByText('Target: 4 laps')).toBeTruthy();
    });
  });
});

describe('<App /> — Running state', () => {
  it('shows current count, target, and Stop / Reset buttons', async () => {
    render(<App />);
    fireEvent.changeText(screen.getByPlaceholderText('10'), '5');
    await act(async () => {
      fireEvent.press(screen.getByText(/▶ Start/));
    });
    await waitFor(() => {
      expect(screen.getByText('Target: 5 laps')).toBeTruthy();
    });
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('/ 5')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.getByText('Reset')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('debug toggle reveals the threshold panel', async () => {
    render(<App />);
    
    // 1. Enable developer debug mode by tapping version 7 times in Settings tab
    fireEvent.press(screen.getByText('Settings'));
    const versionRow = screen.getByText('1.0.0');
    for (let i = 0; i < 7; i++) {
      fireEvent.press(versionRow);
    }
    
    // 2. Go back to Workout tab and start workout
    fireEvent.press(screen.getByText('Workout'));
    fireEvent.changeText(screen.getByPlaceholderText('10'), '3');
    await act(async () => {
      fireEvent.press(screen.getByText(/▶ Start/));
    });

    // 3. Since debug mode is enabled, the debug panel should be visible
    expect(screen.getAllByText(/Debug/).length).toBeGreaterThan(0);
    expect(screen.getByText('phase')).toBeTruthy();
    expect(screen.getByText('BLE similarity')).toBeTruthy();
    expect(screen.getByText(/Magnetic/)).toBeTruthy();
    expect(screen.getByText(/Displacement/)).toBeTruthy();
  });

  it('Reset returns to the Setup screen', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
      if (buttons && buttons.length > 0) {
        const confirmBtn = buttons.find((b: any) => b.text === 'Confirm' || b.style === 'destructive');
        if (confirmBtn && confirmBtn.onPress) {
          confirmBtn.onPress();
        }
      }
    });
    render(<App />);
    fireEvent.changeText(screen.getByPlaceholderText('10'), '3');
    await act(async () => {
      fireEvent.press(screen.getByText(/▶ Start/));
    });
    await waitFor(() => {
      expect(screen.getByText('Target: 3 laps')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Reset'));
    });
    await waitFor(() => {
      expect(screen.getByText('How many laps do you want?')).toBeTruthy();
    });
    alertSpy.mockRestore();
  });

  it('Stop also returns to the Setup screen', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
      if (buttons && buttons.length > 0) {
        const confirmBtn = buttons.find((b: any) => b.text === 'Confirm' || b.style === 'destructive');
        if (confirmBtn && confirmBtn.onPress) {
          confirmBtn.onPress();
        }
      }
    });
    render(<App />);
    fireEvent.changeText(screen.getByPlaceholderText('10'), '3');
    await act(async () => {
      fireEvent.press(screen.getByText(/▶ Start/));
    });
    await waitFor(() => {
      expect(screen.getByText('Target: 3 laps')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Stop'));
    });
    await waitFor(() => {
      expect(screen.getByText('How many laps do you want?')).toBeTruthy();
    });
    alertSpy.mockRestore();
  });
});

describe('<App /> — mode toggle', () => {
  it('shows the Indoor / Outdoor radio with Indoor selected by default', () => {
    render(<App />);
    expect(screen.getByText('Where will you walk?')).toBeTruthy();
    expect(screen.getByText('Indoor')).toBeTruthy();
    expect(screen.getByText('Outdoor')).toBeTruthy();

    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(2);
    expect(radios[0].props.accessibilityState?.selected).toBe(true);
    expect(radios[1].props.accessibilityState?.selected).toBe(false);
  });

  it('switches help text and selection when Outdoor is tapped', () => {
    render(<App />);
    expect(
      screen.getByText(/counts laps using your device's sensors/)
    ).toBeTruthy();

    fireEvent.press(screen.getByText('Outdoor'));

    expect(screen.getByText(/locks onto GPS/)).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios[0].props.accessibilityState?.selected).toBe(false);
    expect(radios[1].props.accessibilityState?.selected).toBe(true);
  });

  it('starts an outdoor session: GPS watcher active, BLE not subscribed', async () => {
    render(<App />);
    fireEvent.press(screen.getByText('Outdoor'));
    fireEvent.changeText(screen.getByPlaceholderText('10'), '3');
    await act(async () => {
      fireEvent.press(screen.getByText(/▶ Start/));
    });
    await waitFor(() => {
      expect(screen.getByText('Target: 3 laps')).toBeTruthy();
      expect(LocationMock.__getActiveWatchers()).toBe(1);
    });
    expect(screen.getByText(/🌳 Outdoor/)).toBeTruthy();
  });

  it('Outdoor debug panel shows GPS-specific stats', async () => {
    render(<App />);
    
    // 1. Enable developer debug mode by tapping version 7 times in Settings tab
    fireEvent.press(screen.getByText('Settings'));
    const versionRow = screen.getByText('1.0.0');
    for (let i = 0; i < 7; i++) {
      fireEvent.press(versionRow);
    }
    
    // 2. Go back to Workout tab, select Outdoor, and start workout
    fireEvent.press(screen.getByText('Workout'));
    fireEvent.press(screen.getByText('Outdoor'));
    fireEvent.changeText(screen.getByPlaceholderText('10'), '3');
    await act(async () => {
      fireEvent.press(screen.getByText(/▶ Start/));
    });

    expect(screen.getByText(/distance \(m\)/)).toBeTruthy();
    expect(screen.getByText(/GPS accuracy/)).toBeTruthy();
    expect(screen.getByText('rejected fixes')).toBeTruthy();
  });
});
