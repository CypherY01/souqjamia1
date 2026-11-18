// CSS Modules imported by web components under test. Next.js types them in apps/web.
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
