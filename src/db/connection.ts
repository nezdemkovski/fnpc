const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export const postgresConnection = () => {
  const url = process.env.DATABASE_URL;
  if (url && url.length > 0) return { connectionString: url };

  return {
    user: required("POSTGRES_USERNAME"),
    password: required("POSTGRES_PASSWORD"),
    host: required("POSTGRES_HOST"),
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: required("POSTGRES_DATABASE"),
  };
};
