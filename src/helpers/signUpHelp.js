import { auth, db } from "@/config/firebase";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";

/**
 * Signs up a new user using Firebase Authentication's native workflow.
 * Uses official sendEmailVerification and keys Firestore user profiles by user.uid.
 */
export const signUpUser = async (email, password, displayName) => {
  try {
    if (!email || !password) {
      return { success: false, message: "Email and password are required." };
    }

    // Create Firebase Auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Set display name in Firebase Auth
    if (displayName) {
      await updateProfile(user, { displayName });
    }

    // Dispatch Firebase native email verification
    try {
      await sendEmailVerification(user);
    } catch (verifError) {
      console.warn("Could not dispatch native verification email:", verifError.message);
    }

    // Create user profile in Firestore keyed strictly by user.uid
    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: displayName || user.displayName || "Coder",
      photoURL: user.photoURL || "/robotic.png",
      authProvider: "email",
      createdAt: serverTimestamp(),
      lastLogin: serverTimestamp(),
      twoFactorEnabled: false,
      workspaces: {},
      settings: {
        theme: "dark",
        fontSize: 14,
        showLineNumbers: true,
        aiSuggestions: true,
      },
      snippets: [],
    });

    return {
      success: true,
      message: "Account created successfully! Please verify your email.",
      user
    };
  } catch (error) {
    let message = error.message;
    if (error.code === "auth/email-already-in-use") {
      message = "This email is already registered. Please log in.";
    } else if (error.code === "auth/weak-password") {
      message = "Password must be at least 6 characters long.";
    } else if (error.code === "auth/invalid-email") {
      message = "Please enter a valid email address.";
    }
    return { success: false, message };
  }
};

/**
 * Resends native verification email to currently signed-in user
 */
export const resendNativeVerificationEmail = async () => {
  try {
    if (!auth.currentUser) {
      return { success: false, message: "No active session found. Please log in." };
    }
    await sendEmailVerification(auth.currentUser);
    return { success: true, message: "Verification email re-sent successfully!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

/**
 * Signs in or registers a user via Google OAuth
 */
export const signInWithGoogle = async () => {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    if (!user) {
      return { success: false, error: "Google authentication was not completed." };
    }

    const userRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(userRef);

    if (!docSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || "Google User",
        photoURL: user.photoURL || "/robotic.png",
        authProvider: "google",
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
        twoFactorEnabled: false,
        workspaces: {},
        settings: {
          theme: "dark",
          fontSize: 14,
          showLineNumbers: true,
          aiSuggestions: true,
        },
        snippets: [],
      });
    } else {
      // Update last login
      await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
    }

    return { success: true, user };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
