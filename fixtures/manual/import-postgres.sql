CREATE TYPE user_status AS ENUM ('active', 'disabled');
CREATE TABLE users (
  id serial PRIMARY KEY,
  email varchar(255) UNIQUE NOT NULL,
  status user_status DEFAULT 'active',
  created_at timestamp NOT NULL
);
CREATE TABLE posts (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id),
  title varchar(255) NOT NULL,
  body text
);
