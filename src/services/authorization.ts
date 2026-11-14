import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../firebase';
import { getUserProfile } from './firebaseService';

export async function verifyCurrentPassword(password: string, adminOnly = false): Promise<boolean> {
  const user = auth?.currentUser;
  if (!user?.email || !password) return false;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    const profile = await getUserProfile(user.uid);
    return Boolean(profile?.activo && (adminOnly ? profile.rol === 'admin' : ['admin', 'recepcionista'].includes(profile.rol)));
  } catch {
    return false;
  }
}
