-- 1. Tabla de Clientes
create table if not exists clientes (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  nombre text not null,
  telefono text,
  token_acceso text unique not null,
  saldo numeric default 0
);

-- 2. Tabla de Servicios / Viajes
create table if not exists servicios (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  cliente_id uuid references clientes(id) on delete cascade not null,
  monto numeric not null,
  descripcion text,
  estado text default 'pendiente'
);
