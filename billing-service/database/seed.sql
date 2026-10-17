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
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.subscriptions (id, account_id, plan, status, next_billing_date, created_at) VALUES
	(1, 1, 'PREMIUM', 'ACTIVA', '2026-10-23 18:05:34.173', '2026-09-23 18:05:08.706'),
	(2, 2, 'BASICO', 'PAGO_FALLIDO', '2026-11-03 21:46:11.671', '2026-10-03 21:46:11.674'),
	(3, 3, 'BASICO', 'PAGO_FALLIDO', '2026-11-03 21:48:59.079', '2026-10-03 21:48:59.081'),
	(4, 999999999, 'BASICO', 'PAGO_FALLIDO', '2026-11-03 21:50:52.151', '2026-10-03 21:50:52.153'),
	(5, 999999999, 'BASICO', 'PAGO_FALLIDO', '2026-11-03 21:51:38.754', '2026-10-03 21:51:38.756'),
	(6, 999999999, 'BASICO', 'PAGO_FALLIDO', '2026-11-03 21:53:27.746', '2026-10-03 21:53:27.747'),
	(7, 6, 'ESTANDAR', 'ACTIVA', '2026-11-04 04:42:11.367', '2026-10-04 04:42:11.375'),
	(8, 7, 'ESTANDAR', 'ACTIVA', '2026-11-04 04:49:40.659', '2026-10-04 04:49:40.661'),
	(9, 10, 'ESTANDAR', 'ACTIVA', '2026-11-08 03:11:48.167', '2026-10-08 03:11:48.173'),
	(10, 11, 'ESTANDAR', 'ACTIVA', '2026-11-08 13:42:36.71', '2026-10-08 13:42:36.713') ON CONFLICT DO NOTHING;


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.payments (id, subscription_id, amount, status, paid_at, created_at, provider, external_id) VALUES
	(1, 1, 7.99, 'EXITOSO', '2026-09-23 18:05:08.699', '2026-09-23 18:05:08.706', 'SIMULADO', NULL),
	(2, 1, 10, 'EXITOSO', '2026-09-23 18:05:17.577', '2026-09-23 18:05:17.579', 'SIMULADO', NULL),
	(3, 1, 17.99, 'EXITOSO', '2026-09-23 18:05:34.173', '2026-09-23 18:05:34.175', 'SIMULADO', NULL),
	(4, 2, 7.99, 'FALLIDO', NULL, '2026-10-03 21:46:11.674', 'SIMULADO', NULL),
	(5, 3, 7.99, 'FALLIDO', NULL, '2026-10-03 21:48:59.081', 'SIMULADO', NULL),
	(6, 4, 7.99, 'FALLIDO', NULL, '2026-10-03 21:50:52.153', 'SIMULADO', NULL),
	(7, 5, 7.99, 'FALLIDO', NULL, '2026-10-03 21:51:38.756', 'SIMULADO', NULL),
	(8, 6, 7.99, 'FALLIDO', NULL, '2026-10-03 21:53:27.747', 'SIMULADO', NULL),
	(9, 7, 12.99, 'EXITOSO', '2026-10-04 04:42:11.368', '2026-10-04 04:42:11.375', 'SIMULADO', NULL),
	(10, 8, 12.99, 'EXITOSO', '2026-10-04 04:49:40.659', '2026-10-04 04:49:40.661', 'SIMULADO', NULL),
	(11, 9, 12.99, 'EXITOSO', '2026-10-08 03:11:48.168', '2026-10-08 03:11:48.173', 'SIMULADO', NULL),
	(12, 10, 12.99, 'EXITOSO', '2026-10-08 13:42:36.71', '2026-10-08 13:42:36.713', 'SIMULADO', NULL) ON CONFLICT DO NOTHING;


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payments_id_seq', 12, true);


--
-- Name: subscriptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.subscriptions_id_seq', 10, true);


--
-- PostgreSQL database dump complete
--


