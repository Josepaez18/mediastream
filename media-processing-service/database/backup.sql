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

DROP INDEX IF EXISTS public.idx_media_job_title_id;
DROP INDEX IF EXISTS public.idx_media_job_status;
ALTER TABLE IF EXISTS ONLY public.media_job DROP CONSTRAINT IF EXISTS media_job_pkey;
ALTER TABLE IF EXISTS ONLY public.alembic_version DROP CONSTRAINT IF EXISTS alembic_version_pkc;
DROP TABLE IF EXISTS public.media_job;
DROP TABLE IF EXISTS public.alembic_version;
DROP TYPE IF EXISTS public.media_job_status;
--
-- Name: media_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.media_job_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'error'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: media_job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_job (
    id uuid NOT NULL,
    title_id character varying NOT NULL,
    status public.media_job_status DEFAULT 'pending'::public.media_job_status NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Data for Name: alembic_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.alembic_version (version_num) FROM stdin;
0001_init_media_job
\.


--
-- Data for Name: media_job; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.media_job (id, title_id, status, created_at, updated_at) FROM stdin;
c89b68be-4e22-44b2-8ce1-5a1bd44ac90a	1	completed	2026-09-23 16:42:59.64526+00	2026-09-23 16:45:16.836451+00
\.


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: media_job media_job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_job
    ADD CONSTRAINT media_job_pkey PRIMARY KEY (id);


--
-- Name: idx_media_job_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_job_status ON public.media_job USING btree (status);


--
-- Name: idx_media_job_title_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_job_title_id ON public.media_job USING btree (title_id);


--
-- PostgreSQL database dump complete
--


