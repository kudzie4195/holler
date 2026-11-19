import { api } from '../services';
import { Screen } from '../ui/kit';
import { ProfileForm } from './ProfileForm';

export function Profile() {
  return (
    <Screen title="Your alerts" tabs>
      <ProfileForm submitLabel="Save changes" busyLabel="Saving..." onSave={(input) => api.updateProfile(input)} />
    </Screen>
  );
}
