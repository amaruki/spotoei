import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  TextRenderable,
  bold,
  fg,
  t,
} from '@opentui/core';
import { COLOR_BORDER_FOCUS, COLOR_DIM, COLOR_PANEL_BG } from '../theme';

export interface OnboardingViewNodes {
  onboarding: BoxRenderable;
  onboardingText: TextRenderable;
  clientIdBox: BoxRenderable;
  clientIdInput: InputRenderable;
}

// Full-screen onboarding flow. Owns the Client ID input (moved out of
// Settings): authentication lives here, Settings is account-only.
export function buildOnboardingView(renderer: CliRenderer): OnboardingViewNodes {
  const onboarding = new BoxRenderable(renderer, {
    id: 'view-onboarding',
    width: '100%',
    flexGrow: 1,
    borderStyle: 'double',
    borderColor: COLOR_BORDER_FOCUS,
    backgroundColor: COLOR_PANEL_BG,
    title: 'Welcome to Spotoei',
    flexDirection: 'column',
    alignItems: 'center',
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    visible: false,
  });
  const onboardingText = new TextRenderable(renderer, {
    id: 'onboarding-text',
    content: '',
    wrapMode: 'word',
    width: '100%',
  });
  onboarding.add(onboardingText);

  const clientIdBox = new BoxRenderable(renderer, {
    id: 'onboarding-client-id-box',
    width: '100%',
    flexDirection: 'column',
    marginTop: 1,
  });
  const clientIdLabel = new TextRenderable(renderer, {
    id: 'client-id-label',
    content: t`${bold('Spotify Client ID')} ${fg(COLOR_DIM)('(press c / Enter to edit):')}`,
  });
  clientIdBox.add(clientIdLabel);
  const clientIdInput = new InputRenderable(renderer, {
    id: 'onboarding-client-id-input',
    placeholder: 'Paste Spotify Client ID here and press Enter…',
    width: '100%',
  });
  clientIdBox.add(clientIdInput);
  const clientIdHelp = new TextRenderable(renderer, {
    id: 'client-id-help',
    content: t`${fg(COLOR_DIM)('Press Enter to save to config.json')}`,
  });
  clientIdBox.add(clientIdHelp);
  onboarding.add(clientIdBox);

  return { onboarding, onboardingText, clientIdBox, clientIdInput };
}
