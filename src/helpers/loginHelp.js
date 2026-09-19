import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "@/config/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { signInWithGoogle } from "./signUpHelp.js";

// Function to log in with Email and Password
export const loginWithEmailAndPassword = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Ensure user profile document exists under users/{user.uid}
    const userRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(userRef);

    if (!docSnap.exists()) {
      // Check if legacy document exists under email
      const legacyRef = doc(db, "users", email);
      const legacySnap = await getDoc(legacyRef);
      const initialData = legacySnap.exists() ? legacySnap.data() : {};

      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || initialData.displayName || "Coder",
        photoURL: user.photoURL || initialData.photoURL || "/robotic.png",
        authProvider: "email",
        createdAt: initialData.createdAt || serverTimestamp(),
        lastLogin: serverTimestamp(),
        twoFactorEnabled: false,
        workspaces: initialData.workspaces || {},
        settings: initialData.settings || {
          theme: "dark",
          fontSize: 14,
          showLineNumbers: true,
          aiSuggestions: true,
        },
        snippets: initialData.snippets || [],
      });
    } else {
      await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
    }

    return user;
  } catch (error) {
    let message = "Invalid credentials or user does not exist.";
    if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
      message = "Incorrect email or password. Please try again.";
    } else if (error.code === "auth/user-not-found") {
      message = "No account found with this email address.";
    } else if (error.code === "auth/too-many-requests") {
      message = "Too many failed attempts. Please try again later.";
    }
    throw new Error(message);
  }
};

// Function to log in with Google (delegated to canonical implementation in signUpHelp.js)
export const loginWithGoogle = signInWithGoogle;
