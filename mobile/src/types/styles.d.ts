// Style imports handled by Metro / Expo web (CSS modules and global CSS).
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.css";
