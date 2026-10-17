--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.profiles DROP CONSTRAINT IF EXISTS profiles_account_id_fkey;
DROP INDEX IF EXISTS public.profiles_account_id_idx;
DROP INDEX IF EXISTS public.accounts_email_key;
DROP INDEX IF EXISTS public.accounts_email_idx;
ALTER TABLE IF EXISTS ONLY public.profiles DROP CONSTRAINT IF EXISTS profiles_pkey;
ALTER TABLE IF EXISTS ONLY public.accounts DROP CONSTRAINT IF EXISTS accounts_pkey;
ALTER TABLE IF EXISTS ONLY public._prisma_migrations DROP CONSTRAINT IF EXISTS _prisma_migrations_pkey;
ALTER TABLE IF EXISTS public.profiles ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.accounts ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.profiles_id_seq;
DROP TABLE IF EXISTS public.profiles;
DROP SEQUENCE IF EXISTS public.accounts_id_seq;
DROP TABLE IF EXISTS public.accounts;
DROP TABLE IF EXISTS public._prisma_migrations;
DROP TYPE IF EXISTS public."AccountStatus";
DROP TYPE IF EXISTS public."AccountRole";
DROP TYPE IF EXISTS public."AccountPlan";
--
-- Name: AccountPlan; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AccountPlan" AS ENUM (
    'GRATIS',
    'BASICO',
    'ESTANDAR',
    'PREMIUM'
);


--
-- Name: AccountRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AccountRole" AS ENUM (
    'USER',
    'ADMIN'
);


--
-- Name: AccountStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AccountStatus" AS ENUM (
    'ACTIVA',
    'MOROSA',
    'SUSPENDIDA'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id bigint NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    status public."AccountStatus" DEFAULT 'ACTIVA'::public."AccountStatus" NOT NULL,
    failed_payment_attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    role public."AccountRole" DEFAULT 'USER'::public."AccountRole" NOT NULL,
    plan public."AccountPlan" DEFAULT 'GRATIS'::public."AccountPlan" NOT NULL
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    name text NOT NULL,
    is_kids boolean DEFAULT false NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.profiles_id_seq OWNED BY public.profiles.id;


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles ALTER COLUMN id SET DEFAULT nextval('public.profiles_id_seq'::regclass);


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
b13dc018-33a9-4a1f-953d-c3ccf572d026	915123d290469c3e6660715251f11d11438547f965fc47bf495d042af6c38cbc	2026-09-23 15:46:43.27291+00	20260916050756_init	\N	\N	2026-09-23 15:46:43.122182+00	1
ca3f1140-faa4-4f88-a8f6-1b2454105d0d	794d79123fe1dd424fd328920f2a13700fb7540880a621dc5a284ed57ffe2c0b	2026-10-04 04:34:53.009365+00	20261003230000_role_plan	\N	\N	2026-10-04 04:34:52.782892+00	1
\.


--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.accounts (id, email, password_hash, status, failed_payment_attempts, created_at, role, plan) FROM stdin;
4	admin@mediastream.com	$2b$10$DfNXyYF9RidfUvN32ShCU.Mf4Qmtouh4eeus2Jf0UjxjrOKxdN9Ry	ACTIVA	0	2026-10-04 04:35:02.946	ADMIN	PREMIUM
1	laura.martinez@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	MOROSA	1	2026-09-23 15:58:21.153	USER	GRATIS
2	carlos.ruiz@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	MOROSA	1	2026-10-03 21:46:06.031	USER	GRATIS
3	sofia.diaz@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	MOROSA	1	2026-10-03 21:48:50.395	USER	GRATIS
5	ana.lopez@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	ACTIVA	0	2026-10-04 04:37:17.711	USER	GRATIS
6	maria.perez@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	ACTIVA	0	2026-10-04 04:41:57.203	USER	ESTANDAR
7	andres.gil@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	ACTIVA	0	2026-10-04 04:49:31.58	USER	ESTANDAR
8	pedro.rojas@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	ACTIVA	0	2026-10-04 04:57:11.821	USER	GRATIS
9	valentina.cruz@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	ACTIVA	0	2026-10-08 02:19:32.027	USER	GRATIS
10	diego.mora@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	ACTIVA	0	2026-10-08 03:11:36.8	USER	ESTANDAR
11	camila.vega@example.com	$2b$10$UkjbLNuXw/KJ0cb2tuz6h.PJTqubv3r1tyoDjlaKsb8vm3MTHsnCe	ACTIVA	0	2026-10-08 13:42:25.983	USER	ESTANDAR
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.profiles (id, account_id, name, is_kids, created_at) FROM stdin;
4	4	Administrador	f	2026-10-04 04:35:02.946
7	6	Niños	t	2026-10-04 04:42:13.286
9	7	Niños	t	2026-10-04 04:49:42.021
13	10	Niños	t	2026-10-08 03:11:50.117
15	11	Niños	t	2026-10-08 13:42:37.979
1	1	Laura	f	2026-09-23 15:58:21.164
2	2	Carlos	f	2026-10-03 21:46:06.066
3	3	Sofía	f	2026-10-03 21:48:50.402
5	5	Ana	f	2026-10-04 04:37:17.73
6	6	María	f	2026-10-04 04:41:57.391
8	7	Andrés	f	2026-10-04 04:49:31.599
10	8	Pedro	f	2026-10-04 04:57:11.837
11	9	Valentina	f	2026-10-08 02:19:32.062
12	10	Diego	f	2026-10-08 03:11:36.852
14	11	Camila	f	2026-10-08 13:42:26.061
\.


--
-- Name: accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.accounts_id_seq', 11, true);


--
-- Name: profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.profiles_id_seq', 15, true);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: accounts_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accounts_email_idx ON public.accounts USING btree (email);


--
-- Name: accounts_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_email_key ON public.accounts USING btree (email);


--
-- Name: profiles_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_account_id_idx ON public.profiles USING btree (account_id);


--
-- Name: profiles profiles_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


