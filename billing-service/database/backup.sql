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

ALTER TABLE IF EXISTS ONLY public.payments DROP CONSTRAINT IF EXISTS payments_subscription_id_fkey;
DROP INDEX IF EXISTS public.subscriptions_account_id_idx;
DROP INDEX IF EXISTS public.payments_subscription_id_idx;
DROP INDEX IF EXISTS public.payments_external_id_key;
ALTER TABLE IF EXISTS ONLY public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_pkey;
ALTER TABLE IF EXISTS ONLY public.payments DROP CONSTRAINT IF EXISTS payments_pkey;
ALTER TABLE IF EXISTS ONLY public._prisma_migrations DROP CONSTRAINT IF EXISTS _prisma_migrations_pkey;
ALTER TABLE IF EXISTS public.subscriptions ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.payments ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS public.subscriptions_id_seq;
DROP TABLE IF EXISTS public.subscriptions;
DROP SEQUENCE IF EXISTS public.payments_id_seq;
DROP TABLE IF EXISTS public.payments;
DROP TABLE IF EXISTS public._prisma_migrations;
DROP TYPE IF EXISTS public."SubscriptionStatus";
DROP TYPE IF EXISTS public."Plan";
DROP TYPE IF EXISTS public."PaymentStatus";
--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'EXITOSO',
    'FALLIDO',
    'PENDIENTE'
);


--
-- Name: Plan; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Plan" AS ENUM (
    'BASICO',
    'ESTANDAR',
    'PREMIUM'
);


--
-- Name: SubscriptionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SubscriptionStatus" AS ENUM (
    'ACTIVA',
    'PAGO_FALLIDO',
    'PAGO_PENDIENTE',
    'CANCELADA'
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
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id bigint NOT NULL,
    subscription_id bigint NOT NULL,
    amount double precision NOT NULL,
    status public."PaymentStatus" NOT NULL,
    paid_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    provider text DEFAULT 'SIMULADO'::text NOT NULL,
    external_id text
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    plan public."Plan" NOT NULL,
    status public."SubscriptionStatus" DEFAULT 'PAGO_PENDIENTE'::public."SubscriptionStatus" NOT NULL,
    next_billing_date timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subscriptions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subscriptions_id_seq OWNED BY public.subscriptions.id;


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions ALTER COLUMN id SET DEFAULT nextval('public.subscriptions_id_seq'::regclass);


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
c5e56d54-54db-4015-849e-e8cce6e707f3	8686efbb2c3317fa93dadf5506a9ff49b1119e64baede257454395075553ba7e	2026-09-23 15:46:43.876111+00	20260922181100_init	\N	\N	2026-09-23 15:46:43.759379+00	1
18d1418a-0ab0-427e-8fe1-9077e5508e63	1c3ac09fd1d00b90802b59be170aa9f9f5bd71199053b7b7acd44d90871c03c1	2026-10-04 04:34:50.822248+00	20261003230000_cancelada	\N	\N	2026-10-04 04:34:50.659939+00	1
51ef6e55-b114-4b0f-a49b-dbc2229431b4	ddee970b08c0771fa14b23d6d9a487716f0e4b8eda19bce9d9f3ab919910e6f0	2026-10-08 13:39:41.35564+00	20261008120000_payment_provider	\N	\N	2026-10-08 13:39:41.27041+00	1
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payments (id, subscription_id, amount, status, paid_at, created_at, provider, external_id) FROM stdin;
1	1	7.99	EXITOSO	2026-09-23 18:05:08.699	2026-09-23 18:05:08.706	SIMULADO	\N
2	1	10	EXITOSO	2026-09-23 18:05:17.577	2026-09-23 18:05:17.579	SIMULADO	\N
3	1	17.99	EXITOSO	2026-09-23 18:05:34.173	2026-09-23 18:05:34.175	SIMULADO	\N
4	2	7.99	FALLIDO	\N	2026-10-03 21:46:11.674	SIMULADO	\N
5	3	7.99	FALLIDO	\N	2026-10-03 21:48:59.081	SIMULADO	\N
6	4	7.99	FALLIDO	\N	2026-10-03 21:50:52.153	SIMULADO	\N
7	5	7.99	FALLIDO	\N	2026-10-03 21:51:38.756	SIMULADO	\N
8	6	7.99	FALLIDO	\N	2026-10-03 21:53:27.747	SIMULADO	\N
9	7	12.99	EXITOSO	2026-10-04 04:42:11.368	2026-10-04 04:42:11.375	SIMULADO	\N
10	8	12.99	EXITOSO	2026-10-04 04:49:40.659	2026-10-04 04:49:40.661	SIMULADO	\N
11	9	12.99	EXITOSO	2026-10-08 03:11:48.168	2026-10-08 03:11:48.173	SIMULADO	\N
12	10	12.99	EXITOSO	2026-10-08 13:42:36.71	2026-10-08 13:42:36.713	SIMULADO	\N
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscriptions (id, account_id, plan, status, next_billing_date, created_at) FROM stdin;
1	1	PREMIUM	ACTIVA	2026-10-23 18:05:34.173	2026-09-23 18:05:08.706
2	2	BASICO	PAGO_FALLIDO	2026-11-03 21:46:11.671	2026-10-03 21:46:11.674
3	3	BASICO	PAGO_FALLIDO	2026-11-03 21:48:59.079	2026-10-03 21:48:59.081
4	999999999	BASICO	PAGO_FALLIDO	2026-11-03 21:50:52.151	2026-10-03 21:50:52.153
5	999999999	BASICO	PAGO_FALLIDO	2026-11-03 21:51:38.754	2026-10-03 21:51:38.756
6	999999999	BASICO	PAGO_FALLIDO	2026-11-03 21:53:27.746	2026-10-03 21:53:27.747
7	6	ESTANDAR	ACTIVA	2026-11-04 04:42:11.367	2026-10-04 04:42:11.375
8	7	ESTANDAR	ACTIVA	2026-11-04 04:49:40.659	2026-10-04 04:49:40.661
9	10	ESTANDAR	ACTIVA	2026-11-08 03:11:48.167	2026-10-08 03:11:48.173
10	11	ESTANDAR	ACTIVA	2026-11-08 13:42:36.71	2026-10-08 13:42:36.713
\.


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payments_id_seq', 12, true);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.subscriptions_id_seq', 10, true);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: payments_external_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX payments_external_id_key ON public.payments USING btree (external_id);


--
-- Name: payments_subscription_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_subscription_id_idx ON public.payments USING btree (subscription_id);


--
-- Name: subscriptions_account_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_account_id_idx ON public.subscriptions USING btree (account_id);


--
-- Name: payments payments_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


