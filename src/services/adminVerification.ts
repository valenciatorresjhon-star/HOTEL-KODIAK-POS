import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../firebase';

/** Verifica la cuenta actual sin contraseñas compartidas incluidas en el código. */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  const user = auth?.currentUser;
  if (!isFirebaseConfigured || !user?.email || !password) return false;
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    const profile = await getDocFromServer(doc(db, 'hotel_users', user.uid));
    return auth.currentUser?.uid === user.uid && profile.exists() &&
      profile.data().rol === 'admin' && profile.data().activo !== false;
  } catch {
    return false;
  }
}
