import { api, push } from '../services';
import { useApp } from '../state/AppContext';
import { Screen } from '../ui/kit';
import { ProfileForm } from './ProfileForm';

export function Onboarding() {
  const app = useApp();
  return (
    <Screen title="Set up your alerts" back={false} end={<button type="button" className="btn ghost small" onClick={() => void app.signOut()}>Sign out</button>}>
      <div className="stack-lg">
        <p className="muted">Tell us what you do and where. We only send alerts that fit.</p>
        <ProfileForm
          submitLabel="Show my alerts"
          busyLabel="Setting up your feed..."
          onSave={async (input) => {
            const me = await api.onboarding(input);
            const ask = push.available() && !(await push.promptSeen());
            app.navigate(ask ? { name: 'push-prompt' } : { name: 'feed' }, { reset: true });
            return me;
          }}
        />
        <p className="small muted" style={{ textAlign: 'center' }}>
          <button type="button" className="link-btn" onClick={() => app.navigate({ name: 'delete' })}>Delete account</button>
        </p>
      </div>
    </Screen>
  );
}
