import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

export default function Settings() {
  const { user, logout } = useAuthStore();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-zinc-900 mb-6 tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input label="Full Name" defaultValue={user?.name} readOnly />
          <Input label="Email Address" defaultValue={user?.email} readOnly />
          <Button className="mt-2">Save Changes</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-400 mb-4">
            Sign out of your account on this device.
          </p>
          <Button variant="danger" onClick={logout}>Sign Out</Button>
        </CardContent>
      </Card>
    </div>
  );
}
