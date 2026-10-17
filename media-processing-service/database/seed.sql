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

--
-- Data for Name: media_job; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.media_job (id, title_id, status, created_at, updated_at) VALUES
	('c89b68be-4e22-44b2-8ce1-5a1bd44ac90a', '1', 'completed', '2026-09-23 16:42:59.64526+00', '2026-09-23 16:45:16.836451+00') ON CONFLICT DO NOTHING;


--
-- PostgreSQL database dump complete
--


