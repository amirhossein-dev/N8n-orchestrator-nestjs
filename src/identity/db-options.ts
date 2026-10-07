export function dbConnection() {
  const port=Number(process.env.DB_PORT || 5432);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('CONFIG_REQUIRED:DB_PORT');
  if(!process.env.DB_PASSWORD)throw new Error('CONFIG_REQUIRED:DB_PASSWORD');
  return {type:'postgres' as const,host:process.env.DB_HOST||'127.0.0.1',port,
    username:process.env.DB_USER||'myuser',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'mydb'};
}
