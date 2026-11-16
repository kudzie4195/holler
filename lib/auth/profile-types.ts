export interface ProfileFormState {
  ok?: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Partial<Record<'business_name' | 'categories' | 'zip' | 'radius', string>>;
}
