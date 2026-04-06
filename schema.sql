--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'WIN1252';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alerta_sistema; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.alerta_sistema (
    id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    tipo character varying(50) NOT NULL,
    fecha date,
    turno character varying(20),
    detalle text NOT NULL,
    resuelta boolean DEFAULT false NOT NULL
);


ALTER TABLE public.alerta_sistema OWNER TO postgres;

--
-- Name: alerta_sistema_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.alerta_sistema_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.alerta_sistema_id_seq OWNER TO postgres;

--
-- Name: alerta_sistema_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.alerta_sistema_id_seq OWNED BY public.alerta_sistema.id;


--
-- Name: dia_cerrado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dia_cerrado (
    id integer NOT NULL,
    fecha date NOT NULL,
    cierre character varying(10) NOT NULL,
    CONSTRAINT dia_cerrado_cierre_check CHECK (((cierre)::text = ANY ((ARRAY['maniana'::character varying, 'noche'::character varying, 'todo'::character varying])::text[])))
);


ALTER TABLE public.dia_cerrado OWNER TO postgres;

--
-- Name: dia_cerrado_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dia_cerrado_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dia_cerrado_id_seq OWNER TO postgres;

--
-- Name: dia_cerrado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dia_cerrado_id_seq OWNED BY public.dia_cerrado.id;


--
-- Name: mesa; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mesa (
    id integer NOT NULL,
    numero character varying(20) NOT NULL,
    min_capacidad integer NOT NULL,
    max_capacidad integer NOT NULL,
    CONSTRAINT mesa_check CHECK ((max_capacidad >= min_capacidad)),
    CONSTRAINT mesa_min_capacidad_check CHECK ((min_capacidad > 0))
);


ALTER TABLE public.mesa OWNER TO postgres;

--
-- Name: mesa_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mesa_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mesa_id_seq OWNER TO postgres;

--
-- Name: mesa_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mesa_id_seq OWNED BY public.mesa.id;


--
-- Name: persona; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.persona (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    telefono character varying(30),
    email character varying(100)
);


ALTER TABLE public.persona OWNER TO postgres;

--
-- Name: persona_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.persona_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.persona_id_seq OWNER TO postgres;

--
-- Name: persona_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.persona_id_seq OWNED BY public.persona.id;


--
-- Name: reserva; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reserva (
    id integer NOT NULL,
    persona_id integer NOT NULL,
    mesa_id integer,
    fecha date NOT NULL,
    hora time without time zone NOT NULL,
    cantidad_personas integer NOT NULL,
    estado character varying(20) DEFAULT 'activa'::character varying NOT NULL,
    turno character varying(20) NOT NULL,
    monto_senia integer,
    CONSTRAINT chk_reserva_estado CHECK (((estado)::text = ANY ((ARRAY['pendiente_senia'::character varying, 'pendiente'::character varying, 'confirmada'::character varying, 'en_turno'::character varying, 'cancelada'::character varying])::text[]))),
    CONSTRAINT chk_reserva_turno CHECK (((turno)::text = ANY ((ARRAY['maniana'::character varying, 'noche_1'::character varying, 'noche_2'::character varying])::text[]))),
    CONSTRAINT reserva_cantidad_personas_check CHECK ((cantidad_personas > 0))
);


ALTER TABLE public.reserva OWNER TO postgres;

--
-- Name: reserva_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reserva_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reserva_id_seq OWNER TO postgres;

--
-- Name: reserva_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reserva_id_seq OWNED BY public.reserva.id;


--
-- Name: alerta_sistema id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta_sistema ALTER COLUMN id SET DEFAULT nextval('public.alerta_sistema_id_seq'::regclass);


--
-- Name: dia_cerrado id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dia_cerrado ALTER COLUMN id SET DEFAULT nextval('public.dia_cerrado_id_seq'::regclass);


--
-- Name: mesa id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mesa ALTER COLUMN id SET DEFAULT nextval('public.mesa_id_seq'::regclass);


--
-- Name: persona id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.persona ALTER COLUMN id SET DEFAULT nextval('public.persona_id_seq'::regclass);


--
-- Name: reserva id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reserva ALTER COLUMN id SET DEFAULT nextval('public.reserva_id_seq'::regclass);


--
-- Name: alerta_sistema alerta_sistema_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta_sistema
    ADD CONSTRAINT alerta_sistema_pkey PRIMARY KEY (id);


--
-- Name: dia_cerrado dia_cerrado_fecha_cierre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dia_cerrado
    ADD CONSTRAINT dia_cerrado_fecha_cierre_key UNIQUE (fecha, cierre);


--
-- Name: dia_cerrado dia_cerrado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dia_cerrado
    ADD CONSTRAINT dia_cerrado_pkey PRIMARY KEY (id);


--
-- Name: mesa mesa_numero_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mesa
    ADD CONSTRAINT mesa_numero_key UNIQUE (numero);


--
-- Name: mesa mesa_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mesa
    ADD CONSTRAINT mesa_pkey PRIMARY KEY (id);


--
-- Name: persona persona_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT persona_pkey PRIMARY KEY (id);


--
-- Name: persona persona_telefono_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT persona_telefono_unique UNIQUE (telefono);


--
-- Name: reserva reserva_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reserva
    ADD CONSTRAINT reserva_pkey PRIMARY KEY (id);


--
-- Name: idx_alerta_sistema_pendiente; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_alerta_sistema_pendiente ON public.alerta_sistema USING btree (resuelta, created_at);


--
-- Name: unique_reserva_mesa_fecha_hora; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX unique_reserva_mesa_fecha_hora ON public.reserva USING btree (mesa_id, fecha, hora) WHERE (mesa_id IS NOT NULL);


--
-- Name: reserva fk_reserva_mesa; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reserva
    ADD CONSTRAINT fk_reserva_mesa FOREIGN KEY (mesa_id) REFERENCES public.mesa(id);


--
-- Name: reserva fk_reserva_persona; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reserva
    ADD CONSTRAINT fk_reserva_persona FOREIGN KEY (persona_id) REFERENCES public.persona(id);


--
-- PostgreSQL database dump complete
--

