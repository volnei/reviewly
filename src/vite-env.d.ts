/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "appstore" for the Mac App Store edition; unset for the direct download. */
  readonly VITE_REVIEWLY_EDITION?: "appstore";
}
